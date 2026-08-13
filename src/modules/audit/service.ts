import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { user } from "../auth/schema";
import { auditLogs } from "./schema";

export async function writeAudit(entry: {
  tenantId: string;
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
