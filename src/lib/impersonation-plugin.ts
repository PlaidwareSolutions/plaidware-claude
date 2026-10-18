import * as z from "zod";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx, sessionMiddleware } from "better-auth/api";
import { deleteSessionCookie, expireCookie, setSessionCookie } from "better-auth/cookies";
import { hasOpsLevel } from "./roles";
import { isImpersonatedSessionAllowedPath } from "./impersonation-surface";
import { viewAsMessage } from "../policy/impersonation";

/**
 * "View as": an ops admin gets a real, one-hour, read-only session of another
 * user; their own session token waits in a signed cookie until they stop.
 *
 * Only the two impersonation endpoints of Better Auth's admin plugin are
 * mirrored here (that plugin would add user.role/banned columns, a second
 * permission model keyed on `role` and 13 more endpoints). Both endpoints are
 * in `disabledPaths` (src/lib/auth.ts): reachable via auth.api from server
 * actions only, where src/policy requireOps("admin") is the real gate — the
 * checks in here are defense in depth. Read-only is enforced by
 * src/policy requireUser() for the app and by this plugin's before-hook for
 * every Better Auth route (src/lib/impersonation-surface.ts lists the few
 * that stay open).
 */
export const IMPERSONATION_TTL_SECONDS = 60 * 60;
/** `<prefix>.impersonator_session`: the admin's own session token, signed, while they view. */
export const IMPERSONATOR_COOKIE = "impersonator_session";
export const READ_ONLY_IMPERSONATION_CODE = "READ_ONLY_IMPERSONATION";

type PlatformUser = { id: string; platformRole?: string | null; disabledAt?: Date | string | null };
const isActiveOpsAdmin = (u: PlatformUser | null | undefined) => !!u && !u.disabledAt && hasOpsLevel(u.platformRole, "admin");

const startImpersonation = createAuthEndpoint(
  "/impersonation/start",
  {
    method: "POST",
    body: z.object({ userId: z.string().min(1) }),
    use: [sessionMiddleware],
  },
  async (ctx) => {
    const actorUser = ctx.context.session.user as typeof ctx.context.session.user & PlatformUser;
    const actorSession = ctx.context.session.session as typeof ctx.context.session.session & { impersonatedBy?: string | null };
    if (!isActiveOpsAdmin(actorUser)) throw new APIError("FORBIDDEN", { message: "Only ops admins can view as another user." });
    if (actorSession.impersonatedBy) throw new APIError("FORBIDDEN", { message: "Stop viewing as the current user first." });
    if (ctx.body.userId === actorUser.id) throw new APIError("BAD_REQUEST", { message: "You can't view as yourself." });

    const target = (await ctx.context.internalAdapter.findUserById(ctx.body.userId)) as
      | (Awaited<ReturnType<typeof ctx.context.internalAdapter.findUserById>> & PlatformUser)
      | null;
    if (!target) throw new APIError("NOT_FOUND", { message: "User not found" });
    if (hasOpsLevel(target.platformRole, "admin")) throw new APIError("FORBIDDEN", { message: "Ops admins can't be viewed as." });
    // The session.create.before hook in src/lib/auth.ts refuses this too; saying it here gives a clear reason.
    if (target.disabledAt) throw new APIError("FORBIDDEN", { message: "This account is disabled." });

    // dontRememberMe + overrideAll: the row keeps this expiresAt (createSession
    // recomputes it otherwise) and get-session never extends a session whose
    // browser holds the dont_remember cookie — so one hour means one hour.
    const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_SECONDS * 1000);
    const session = await ctx.context.internalAdapter.createSession(
      target.id,
      true,
      { impersonatedBy: actorUser.id, expiresAt },
      true,
    );
    if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Failed to create the view-as session" });

    const authCookies = ctx.context.authCookies;
    const dontRemember = await ctx.getSignedCookie(authCookies.dontRememberToken.name, ctx.context.secret);
    deleteSessionCookie(ctx);
    const stash = ctx.context.createAuthCookie(IMPERSONATOR_COOKIE);
    // The stash must not outlive its use: one hour, not the session cookie's week.
    await ctx.setSignedCookie(stash.name, `${actorSession.token}:${dontRemember || ""}`, ctx.context.secret, {
      ...authCookies.sessionToken.attributes,
      maxAge: IMPERSONATION_TTL_SECONDS,
    });
    await setSessionCookie(ctx, { session, user: target }, true);
    return ctx.json({
      session: { id: session.id, expiresAt: session.expiresAt },
      user: { id: target.id, email: target.email, name: target.name },
    });
  },
);

const stopImpersonation = createAuthEndpoint(
  "/impersonation/stop",
  { method: "POST", requireHeaders: true },
  async (ctx) => {
    // The view-as row may already be gone (revoked, expired): still let the
    // admin back in from the stash, and always leave a clean cookie jar.
    const current = await getSessionFromCtx(ctx);
    const impersonatedBy = (current?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy ?? null;
    if (current && !impersonatedBy) throw new APIError("BAD_REQUEST", { message: "You're not viewing as anyone." });

    const stash = ctx.context.createAuthCookie(IMPERSONATOR_COOKIE);
    const stashed = await ctx.getSignedCookie(stash.name, ctx.context.secret);
    const [adminToken, dontRemember] = (stashed || "").split(":");
    const admin = adminToken ? await ctx.context.internalAdapter.findSession(adminToken) : null;
    const restorable =
      !!admin &&
      admin.session.expiresAt > new Date() &&
      (!impersonatedBy || admin.user.id === impersonatedBy) &&
      isActiveOpsAdmin(admin.user as PlatformUser);

    if (current) await ctx.context.internalAdapter.deleteSession(current.session.token);
    // Also clears dont_remember, which the view-as session set (leaving it would
    // stop the admin's own session from refreshing after the swap back).
    deleteSessionCookie(ctx);
    expireCookie(ctx, stash);
    if (!restorable || !admin) return ctx.json({ restored: false as const, actorUserId: null });
    await setSessionCookie(ctx, admin, !!dontRemember);
    return ctx.json({ restored: true as const, actorUserId: admin.user.id });
  },
);

/** Every route not listed in impersonation-surface.ts is refused for a view-as session. */
const refuseWhileViewing = createAuthMiddleware(async (ctx) => {
  const s = await getSessionFromCtx(ctx);
  const impersonatedBy = (s?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy;
  if (s && impersonatedBy) {
    throw new APIError("FORBIDDEN", { message: viewAsMessage(s.user.name), code: READ_ONLY_IMPERSONATION_CODE });
  }
});

/** Sign out means the human signs out: the stashed admin session goes too. */
const cleanUpStashOnSignOut = createAuthMiddleware(async (ctx) => {
  const stash = ctx.context.createAuthCookie(IMPERSONATOR_COOKIE);
  const stashed = await ctx.getSignedCookie(stash.name, ctx.context.secret);
  if (!stashed) return;
  const [adminToken] = stashed.split(":");
  if (adminToken) await ctx.context.internalAdapter.deleteSession(adminToken);
  expireCookie(ctx, stash);
});

export const impersonationPlugin = {
  id: "impersonation",
  endpoints: { startImpersonation, stopImpersonation },
  schema: {
    session: {
      fields: {
        // `input: false`: never settable from a request body (update-session included).
        impersonatedBy: { type: "string", required: false, input: false },
      },
    },
  },
  hooks: {
    before: [{ matcher: (ctx) => !isImpersonatedSessionAllowedPath(ctx.path), handler: refuseWhileViewing }],
    after: [{ matcher: (ctx) => ctx.path === "/sign-out", handler: cleanUpStashOnSignOut }],
  },
} satisfies BetterAuthPlugin;
