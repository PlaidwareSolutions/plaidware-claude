import { eq } from "drizzle-orm";
import { db } from "../../db";
import { session, user } from "../auth/schema";
import { writeAudit } from "../audit/service";
import { isDowngrade, normalizePlatformRole, type PlatformRole } from "@/lib/roles";
import { countOpsAdmins } from "./queries";
import { canChangePlatformRole } from "./rules";

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

export async function revokeUserSessions(userId: string): Promise<void> {
  await db.delete(session).where(eq(session.userId, userId));
}
