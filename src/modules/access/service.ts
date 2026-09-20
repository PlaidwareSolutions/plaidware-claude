import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { auth } from "../../lib/auth";
import { emailButton, emailShell, sendEmail } from "../../lib/email";
import { PLACEHOLDER_PHONE } from "../../lib/phone";
import { AUTH } from "../../lib/routes";
import { env } from "../../env";
import { session, user } from "../auth/schema";
import { writeAudit } from "../audit/service";
import { PLATFORM_ROLE_META, isDowngrade, normalizePlatformRole, type PlatformRole } from "@/lib/roles";
import { countActiveOpsAdmins, countOpsAdmins } from "./queries";
import {
  canChangePlatformRole,
  canRevokeAllSessions,
  canRevokeSession,
  canSendPasswordSetup,
  canSetAccountDisabled,
  type StaffRole,
} from "./rules";

/**
 * Platform roles are written only here (and read by src/policy). The
 * Better Auth config marks platformRole `input: false`, so no client
 * payload can ever set it; the Access tab and the bootstrap script call
 * this with an actor (null = the script) and every change lands in the
 * platform audit trail.
 */
export async function setPlatformRole(opts: {
  userId: string;
  role: PlatformRole;
  actorUserId: string | null;
}): Promise<{ before: PlatformRole; after: PlatformRole; sessionsRevoked: boolean }> {
  const target = await db.query.user.findFirst({
    where: eq(user.id, opts.userId),
    columns: { id: true, email: true, emailVerified: true, platformRole: true },
  });
  if (!target) throw new Error("User not found");
  const before = normalizePlatformRole(target.platformRole);
  const verdict = canChangePlatformRole({
    actorUserId: opts.actorUserId,
    targetUserId: target.id,
    targetEmailVerified: target.emailVerified,
    current: before,
    next: opts.role,
    opsAdminCount: await countOpsAdmins(),
  });
  if (!verdict.ok) throw new Error(verdict.reason);

  await db.update(user).set({ platformRole: opts.role }).where(eq(user.id, opts.userId));
  // Sessions read platformRole fresh on every request (no cookie cache),
  // so a downgrade takes effect immediately; signing the user out as well
  // drops any stale ops UI they have open.
  const sessionsRevoked = isDowngrade(before, opts.role);
  if (sessionsRevoked) await revokeUserSessions(opts.userId);
  await writeAudit({
    tenantId: null,
    actorUserId: opts.actorUserId,
    kind: "platform_role_changed",
    payload: { targetUserId: target.id, targetEmail: target.email, before, after: opts.role, sessionsRevoked },
  });
  return { before, after: opts.role, sessionsRevoked };
}

export async function revokeUserSessions(userId: string): Promise<number> {
  const rows = await db.delete(session).where(eq(session.userId, userId)).returning({ id: session.id });
  return rows.length;
}

/** Ops signs a person out of one device (audited). */
export async function revokeSession(opts: { userId: string; sessionId: string; actorUserId: string; currentSessionId: string }) {
  const verdict = canRevokeSession({
    actorUserId: opts.actorUserId,
    targetUserId: opts.userId,
    sessionId: opts.sessionId,
    currentSessionId: opts.currentSessionId,
  });
  if (!verdict.ok) throw new Error(verdict.reason);
  const target = await db.query.user.findFirst({ where: eq(user.id, opts.userId), columns: { email: true } });
  if (!target) throw new Error("User not found");
  const rows = await db
    .delete(session)
    .where(and(eq(session.id, opts.sessionId), eq(session.userId, opts.userId)))
    .returning({ id: session.id });
  if (rows.length === 0) throw new Error("That session is already gone.");
  await writeAudit({
    tenantId: null,
    actorUserId: opts.actorUserId,
    kind: "sessions_revoked",
    payload: { targetUserId: opts.userId, targetEmail: target.email, count: 1, sessionId: opts.sessionId, all: false },
  });
}

/** Ops signs a person out everywhere (audited). */
export async function revokeAllSessions(opts: { userId: string; actorUserId: string }): Promise<{ count: number }> {
  const verdict = canRevokeAllSessions({ actorUserId: opts.actorUserId, targetUserId: opts.userId });
  if (!verdict.ok) throw new Error(verdict.reason);
  const target = await db.query.user.findFirst({ where: eq(user.id, opts.userId), columns: { email: true } });
  if (!target) throw new Error("User not found");
  const count = await revokeUserSessions(opts.userId);
  await writeAudit({
    tenantId: null,
    actorUserId: opts.actorUserId,
    kind: "sessions_revoked",
    payload: { targetUserId: opts.userId, targetEmail: target.email, count, all: true },
  });
  return { count };
}

/**
 * Disable or re-enable an account. Disabling signs the person out everywhere
 * and src/lib/auth.ts refuses every new session or reset/magic-link mail
 * while `disabledAt` is set; roles, memberships and history are untouched.
 */
export async function setAccountDisabled(opts: {
  userId: string;
  disabled: boolean;
  reason?: string | null;
  actorUserId: string | null;
}): Promise<{ sessionsRevoked: number }> {
  const target = await db.query.user.findFirst({
    where: eq(user.id, opts.userId),
    columns: { id: true, email: true, platformRole: true, disabledAt: true },
  });
  if (!target) throw new Error("User not found");
  const role = normalizePlatformRole(target.platformRole);
  const verdict = canSetAccountDisabled({
    actorUserId: opts.actorUserId,
    targetUserId: target.id,
    targetRole: role,
    currentlyDisabled: !!target.disabledAt,
    disabled: opts.disabled,
    activeOpsAdminCount: await countActiveOpsAdmins(),
  });
  if (!verdict.ok) throw new Error(verdict.reason);

  const reason = opts.reason?.trim() || null;
  await db
    .update(user)
    .set(opts.disabled ? { disabledAt: new Date(), disabledReason: reason } : { disabledAt: null, disabledReason: null })
    .where(eq(user.id, target.id));
  const sessionsRevoked = opts.disabled ? await revokeUserSessions(target.id) : 0;
  await writeAudit({
    tenantId: null,
    actorUserId: opts.actorUserId,
    kind: opts.disabled ? "account_disabled" : "account_enabled",
    payload: { targetUserId: target.id, targetEmail: target.email, role, reason, sessionsRevoked },
  });
  return { sessionsRevoked };
}

/**
 * Ops creates a staff account (developer, ops support or ops admin). The row
 * is inserted directly (not via signUpEmail, which would mail a verification
 * link and auto-sign-in a passwordless account) as a verified customer, then
 * promoted through setPlatformRole so the usual guards and the platform audit
 * trail apply. No password exists until the person follows the set-password
 * link: Better Auth's reset flow creates the credential account on first use.
 */
export async function createStaffAccount(opts: {
  email: string;
  firstName: string;
  lastName: string;
  role: StaffRole;
  actorUserId: string;
}): Promise<{ userId: string }> {
  const email = opts.email.trim().toLowerCase();
  const firstName = opts.firstName.trim();
  const lastName = opts.lastName.trim();
  const existing = await db.query.user.findFirst({ where: eq(user.email, email), columns: { id: true } });
  if (existing) throw new Error("An account with this email already exists — change its role in the table instead.");

  const userId = crypto.randomUUID();
  const now = new Date();
  await db.insert(user).values({
    id: userId,
    name: `${firstName} ${lastName}`.trim(),
    email,
    emailVerified: true,
    firstName,
    lastName,
    phone: PLACEHOLDER_PHONE,
    platformRole: "customer",
    createdAt: now,
    updatedAt: now,
  });
  await setPlatformRole({ userId, role: opts.role, actorUserId: opts.actorUserId });
  await writeAudit({
    tenantId: null,
    actorUserId: opts.actorUserId,
    kind: "platform_account_created",
    payload: { targetUserId: userId, targetEmail: email, role: opts.role },
  });
  const meta = PLATFORM_ROLE_META[opts.role];
  await sendEmail({
    to: email,
    subject: "Welcome to Plaidware Hub",
    html: emailShell(
      `You've been added as ${meta.label}`,
      `<p>Hi ${firstName}, an ops admin added ${email} to Plaidware Hub as <strong>${meta.label}</strong>: ${meta.description.toLowerCase()}.</p>` +
        `<p>A second email carries your set-password link (valid for one hour). After that you can also sign in any time with a magic link from the login page.</p>` +
        emailButton(`${env.APP_BASE_URL}${AUTH.login}`, "Open Plaidware Hub"),
    ),
  });
  await sendPasswordSetup({ userId });
  return { userId };
}

/**
 * (Re)send the set-password link: staff accounts created here, or a client
 * whose setup link died. The mail only ever reaches the account's own inbox
 * (the same one forgot-password sends), so any non-disabled account may get it.
 */
export async function sendPasswordSetup(opts: { userId: string }): Promise<{ email: string }> {
  const target = await db.query.user.findFirst({
    where: eq(user.id, opts.userId),
    columns: { email: true, platformRole: true, disabledAt: true },
  });
  if (!target) throw new Error("User not found");
  const allowed = canSendPasswordSetup({ targetDisabled: !!target.disabledAt });
  if (!allowed.ok) throw new Error(allowed.reason);
  // Better Auth mails the link through sendResetPassword (src/lib/auth.ts).
  await auth.api.requestPasswordReset({ body: { email: target.email, redirectTo: AUTH.resetPassword } });
  console.log(`[access] set-password link sent to ${target.email} (${PLATFORM_ROLE_META[normalizePlatformRole(target.platformRole)].label})`);
  return { email: target.email };
}
