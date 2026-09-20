import { desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { organization, user } from "../auth/schema";
import { auditLogs } from "./schema";

export async function writeAudit(entry: {
  /** Null for platform-level events (no client involved). */
  tenantId: string | null;
  subscriptionId?: string | null;
  actorUserId?: string | null;
  kind: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLogs).values({
    tenantId: entry.tenantId,
    subscriptionId: entry.subscriptionId ?? null,
    actorUserId: entry.actorUserId ?? null,
    kind: entry.kind,
    payload: entry.payload ?? {},
  });
}

export type TimelineEntry = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  actorName: string | null;
  subscriptionId: string | null;
  createdAt: string;
  /** Extra framing for cross-tenant feeds ("did · Acme"); absent on tenant feeds. */
  context?: string | null;
};

export async function tenantTimeline(tenantId: string, limit = 50): Promise<TimelineEntry[]> {
  const rows = await db
    .select({
      id: auditLogs.id,
      kind: auditLogs.kind,
      payload: auditLogs.payload,
      subscriptionId: auditLogs.subscriptionId,
      createdAt: auditLogs.createdAt,
      actorName: user.name,
    })
    .from(auditLogs)
    .leftJoin(user, eq(auditLogs.actorUserId, user.id))
    .where(eq(auditLogs.tenantId, tenantId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** Platform-level events (ops role grants and revokes), newest first. */
export async function platformTimeline(limit = 50): Promise<TimelineEntry[]> {
  const rows = await db
    .select({
      id: auditLogs.id,
      kind: auditLogs.kind,
      payload: auditLogs.payload,
      subscriptionId: auditLogs.subscriptionId,
      createdAt: auditLogs.createdAt,
      actorName: user.name,
    })
    .from(auditLogs)
    .leftJoin(user, eq(auditLogs.actorUserId, user.id))
    .where(isNull(auditLogs.tenantId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/**
 * Everything one person did, and everything done to their account, across
 * every workspace. Ownership transfers key on fromUserId/toUserId and stay on
 * the client's Activity tab; the three arms below are each indexed.
 */
export async function userTimeline(userId: string, limit = 200): Promise<TimelineEntry[]> {
  const rows = await db
    .select({
      id: auditLogs.id,
      kind: auditLogs.kind,
      payload: auditLogs.payload,
      subscriptionId: auditLogs.subscriptionId,
      createdAt: auditLogs.createdAt,
      actorUserId: auditLogs.actorUserId,
      actorName: user.name,
      tenantName: organization.name,
    })
    .from(auditLogs)
    .leftJoin(user, eq(auditLogs.actorUserId, user.id))
    .leftJoin(organization, eq(auditLogs.tenantId, organization.id))
    .where(
      or(
        eq(auditLogs.actorUserId, userId),
        sql`${auditLogs.payload}->>'targetUserId' = ${userId}`,
        sql`${auditLogs.payload}->>'userId' = ${userId}`,
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return rows.map(({ actorUserId, tenantName, ...r }) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    context: [actorUserId === userId ? "did" : "done to them", tenantName].filter(Boolean).join(" · "),
  }));
}
