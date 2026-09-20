import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, organization } from "better-auth/plugins";
import { db } from "../db";
import { env } from "../env";
import { sendEmail, emailShell, emailButton } from "./email";
import { INVITATION_DAYS, sendInvitationEmail } from "./invite-email";
import { writeAudit } from "../modules/audit/service";
import { sendAccountVerificationEmail } from "./account-email";
import { ac, orgRoles } from "./org-roles";
import { disabledOrgPaths } from "./org-http-surface";
import { ACCOUNT_DISABLED_CODE, ACCOUNT_DISABLED_MESSAGE } from "./account-status";
import { AUTH, withQuery } from "./routes";
import { orgMutationBlockReason } from "../policy/org-guards";
import {
  emitMembershipChanged,
  emitOrganizationUpdated,
} from "../modules/webhooks_out/service";

function forbidIf(reason: string | null): void {
  if (reason) throw new APIError("FORBIDDEN", { message: reason });
}

const accountDisabledError = () =>
  new APIError("FORBIDDEN", { message: ACCOUNT_DISABLED_MESSAGE, code: ACCOUNT_DISABLED_CODE });

/** The internal adapter types users without additional fields; we only need this one. */
const isDisabled = (u: unknown) => !!(u as { disabledAt?: Date | null } | null | undefined)?.disabledAt;

/**
 * Tenant = Better Auth organization. Instantiated once so the HTTP surface
 * below can be derived from the endpoints it registers.
 */
const orgPlugin = organization({
  ac,
  roles: orgRoles,
  creatorRole: "owner",
  // Workspaces are created only by a first purchase (createCheckoutAction)
  // or ops onboarding, and deleted only by ops (deleteTenant, which refuses
  // while subscriptions are live). Never through Better Auth's own routes.
  allowUserToCreateOrganization: false,
  disableOrganizationDeletion: true,
  // The email promises 7 days; Better Auth's default was 48 hours.
  invitationExpiresIn: INVITATION_DAYS * 86_400,
  // Explicit: an unverified session may not accept (sign-in already requires
  // verification; the derived default here would have been false).
  requireEmailVerificationOnInvitation: true,
  schema: {
    organization: {
      additionalFields: {
        // 'active' | 'suspended' | 'inactive' — tenant lifecycle (PRD §4.2)
        status: { type: "string", defaultValue: "active", input: false },
        // Billing identity lives on the tenant, not the user (PRD §2)
        stripeCustomerId: { type: "string", required: false, input: false },
      },
    },
  },
  // MHub lifecycle (integration contract §B): org/membership changes made
  // through Better Auth surface here. The emit functions no-op unless the
  // org holds a live marketing-* subscription, and never throw.
  // Direct-Drizzle mutations (transferOwnership) emit at their own sites.
  organizationHooks: {
    // Defense in depth for the auth.api paths and the one browser route
    // (accept-invitation): the tenant-status gate and the unique-owner rule
    // hold even if a caller skips src/policy. Ops paths in tenancy/service
    // write directly and are unaffected — ops must act on suspended tenants.
    beforeCreateInvitation: async ({ invitation, organization: org }) => {
      forbidIf(orgMutationBlockReason("invite", { status: org.status }, { role: invitation.role }));
    },
    beforeAddMember: async ({ member, organization: org }) => {
      forbidIf(orgMutationBlockReason("add", { status: org.status }, { role: member.role }));
    },
    beforeAcceptInvitation: async ({ invitation, organization: org }) => {
      forbidIf(orgMutationBlockReason("accept", { status: org.status }, { role: invitation.role }));
    },
    beforeUpdateMemberRole: async ({ member, newRole, organization: org }) => {
      forbidIf(orgMutationBlockReason("update-role", { status: org.status }, { role: member.role, newRole }));
    },
    beforeRemoveMember: async ({ member, organization: org }) => {
      forbidIf(orgMutationBlockReason("remove", { status: org.status }, { role: member.role }));
    },
    // Tenant-side invites go through auth.api.createInvitation; audit them
    // here so the client's Activity tab matches the ops path (opsInviteMember
    // writes its own row and never fires this hook).
    afterCreateInvitation: async ({ invitation, inviter, organization: org }) => {
      await writeAudit({
        tenantId: org.id,
        actorUserId: inviter.id,
        kind: "member_invited",
        payload: { email: invitation.email, role: invitation.role, invitationId: invitation.id },
      });
    },
    afterUpdateOrganization: async ({ organization: org }) => {
      if (org) await emitOrganizationUpdated(org.id);
    },
    afterAddMember: async ({ member }) => {
      await emitMembershipChanged({
        orgId: member.organizationId,
        userId: member.userId,
        role: member.role,
        action: "added",
      });
    },
    afterAcceptInvitation: async ({ member }) => {
      await emitMembershipChanged({
        orgId: member.organizationId,
        userId: member.userId,
        role: member.role,
        action: "added",
      });
    },
    afterUpdateMemberRole: async ({ member }) => {
      await emitMembershipChanged({
        orgId: member.organizationId,
        userId: member.userId,
        role: member.role,
        action: "updated",
      });
    },
    afterRemoveMember: async ({ member }) => {
      await emitMembershipChanged({
        orgId: member.organizationId,
        userId: member.userId,
        role: member.role,
        action: "removed",
      });
    },
  },
  sendInvitationEmail: async (data) => {
    await sendInvitationEmail({
      to: data.email,
      invitationId: data.id,
      organizationName: data.organization.name,
      inviterName: data.inviter.user.name,
      role: data.role,
    });
  },
});

export const auth = betterAuth({
  baseURL: env.APP_BASE_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [
    env.APP_BASE_URL,
    ...(env.TRUSTED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ],
  database: drizzleAdapter(db, { provider: "pg" }),
  // Org mutations are server-side only (src/lib/org-http-surface.ts): every
  // /organization/* route except accept-invitation is 404 over HTTP.
  // auth.api.* calls skip the router, so server actions are unaffected.
  // Profile and email changes go through src/modules/account (server-side
  // phone normalisation, a notice to the old address, an audit row), so the
  // raw routes are closed too.
  disabledPaths: [...disabledOrgPaths(Object.values(orgPlugin.endpoints).map((e) => e.path)), "/update-user", "/change-email"],

  advanced: {
    // Session shared with sibling apps (marketing.plaidware.com) via
    // Domain=.plaidware.com. Unset locally so localhost keeps host-only cookies.
    ...(env.COOKIE_DOMAIN && {
      crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN },
    }),
    // Staging and production both set Domain=.plaidware.com cookies; a
    // per-env name prefix keeps one environment's sign-in from clobbering
    // the other's session in the same browser.
    ...(env.COOKIE_PREFIX && { cookiePrefix: env.COOKIE_PREFIX }),
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Set or reset your Plaidware password",
        html: emailShell(
          "Set your password",
          `<p>Use the button below to choose a new password for ${user.email}. This link is valid for one hour.</p>` +
            emailButton(url, "Set password") +
            `<p>If you didn't request this, you can safely ignore this email.</p>`,
        ),
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24, // 24h, matching the old app's contract
    // Signup verification and change-email confirmation share this callback
    // (src/lib/account-email.ts tells them apart by user.emailVerified).
    sendVerificationEmail: async ({ user, url }) => sendAccountVerificationEmail({ user, url }),
  },

  user: {
    additionalFields: {
      firstName: { type: "string", required: true },
      lastName: { type: "string", required: true },
      phone: { type: "string", required: true },
      // PLATFORM_ROLES (src/lib/roles.ts) — never settable from client input
      platformRole: { type: "string", defaultValue: "customer", input: false },
      // Account lifecycle (src/lib/account-status.ts); written only by src/modules/access
      disabledAt: { type: "date", required: false, input: false },
      disabledReason: { type: "string", required: false, input: false },
    },
    // One confirmation link to the NEW address (a two-step flow would strand
    // anyone whose old mailbox is gone); the account module mails the old
    // address a notice instead.
    changeEmail: { enabled: true },
  },

  // A disabled account never gets a session, whichever door it uses:
  // password, magic link, verification auto-sign-in or password reset all end
  // in createSession. The magic-link verifier renders a thrown APIError as
  // JSON, so that path is bounced to the login page instead.
  databaseHooks: {
    session: {
      create: {
        before: async (session, ctx) => {
          if (!ctx) return;
          const u = await ctx.context.internalAdapter.findUserById(session.userId);
          if (!isDisabled(u)) return;
          if (ctx.path === "/magic-link/verify") {
            throw ctx.redirect(`${env.APP_BASE_URL}${withQuery(AUTH.login, { error: ACCOUNT_DISABLED_CODE })}`);
          }
          throw accountDisabledError();
        },
      },
    },
  },
  // …and no mail goes out to one either (runs for HTTP and auth.api alike).
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/request-password-reset" && ctx.path !== "/sign-in/magic-link") return;
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (typeof email !== "string") return;
      const found = await ctx.context.internalAdapter.findUserByEmail(email);
      if (isDisabled(found?.user)) throw accountDisabledError();
    }),
  },

  plugins: [
    magicLink({
      // Sign-in only: signup needs firstName/lastName/phone, which a magic
      // link can't collect — new users go through /signup. Verifying the link
      // proves the address, so Better Auth flips emailVerified for
      // still-unverified accounts (consistent with the verification gate).
      disableSignUp: true,
      expiresIn: 60 * 5,
      rateLimit: { window: 60, max: 5 },
      storeToken: "hashed",
      sendMagicLink: async ({ email, url }) => {
        await sendEmail({
          to: email,
          subject: "Your Plaidware sign-in link",
          html: emailShell(
            "Sign in to Plaidware",
            `<p>Click the button below to sign in as ${email}. This link is valid for 5 minutes and can be used once.</p>` +
              emailButton(url, "Sign in") +
              `<p>If you didn't request this, you can safely ignore this email.</p>`,
          ),
        });
      },
    }),
    orgPlugin,
  ],
});

export type Auth = typeof auth;
