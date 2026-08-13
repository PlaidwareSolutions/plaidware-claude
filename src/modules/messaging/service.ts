import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { organization } from "../auth/schema";
import { messageThreads, messages } from "./schema";

export type ThreadRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  subject: string;
  status: string;
  lastMessageAt: string;
  lastMessageBy: string;
  unread: number;
  preview: string;
};

type Viewer = "tenant" | "ops";

export async function listThreads(viewer: Viewer, tenantId?: string): Promise<ThreadRow[]> {
  const threads = await db
    .select({
      id: messageThreads.id,
      tenantId: messageThreads.tenantId,
      tenantName: organization.name,
      subject: messageThreads.subject,
      status: messageThreads.status,
      lastMessageAt: messageThreads.lastMessageAt,
      lastMessageBy: messageThreads.lastMessageBy,
    })
    .from(messageThreads)
    .innerJoin(organization, eq(messageThreads.tenantId, organization.id))
    .where(tenantId ? eq(messageThreads.tenantId, tenantId) : undefined)
    .orderBy(desc(messageThreads.lastMessageAt))
    .limit(100);
  if (threads.length === 0) return [];

  const msgs = await db.query.messages.findMany({
    where: inArray(messages.threadId, threads.map((t) => t.id)),
    orderBy: [desc(messages.createdAt)],
  });
  return threads.map((t) => {
    const mine = msgs.filter((m) => m.threadId === t.id);
    const unread = mine.filter((m) =>
      viewer === "tenant"
        ? m.senderRole === "ops" && !m.readByTenantAt
        : m.senderRole === "tenant" && !m.readByOpsAt,
    ).length;
    return {
      ...t,
      lastMessageAt: t.lastMessageAt.toISOString(),
      unread,
      preview: mine[0]?.body.slice(0, 80) ?? "",
    };
  });
}

export async function unreadCount(viewer: Viewer, tenantId?: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(messages)
    .innerJoin(messageThreads, eq(messages.threadId, messageThreads.id))
    .where(
      and(
        viewer === "tenant"
          ? and(eq(messages.senderRole, "ops"), isNull(messages.readByTenantAt))
          : and(eq(messages.senderRole, "tenant"), isNull(messages.readByOpsAt)),
        tenantId ? eq(messageThreads.tenantId, tenantId) : undefined,
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

export async function getThreadWithMessages(threadId: string, viewer: Viewer) {
  const thread = await db.query.messageThreads.findFirst({
    where: eq(messageThreads.id, threadId),
  });
  if (!thread) return null;
  // Opening marks the viewer's side read (PRD §4.10).
  await db
    .update(messages)
    .set(viewer === "tenant" ? { readByTenantAt: new Date() } : { readByOpsAt: new Date() })
    .where(
      and(
        eq(messages.threadId, threadId),
        eq(messages.senderRole, viewer === "tenant" ? "ops" : "tenant"),
        viewer === "tenant" ? isNull(messages.readByTenantAt) : isNull(messages.readByOpsAt),
      ),
    );
  const rows = await db.query.messages.findMany({
    where: eq(messages.threadId, threadId),
    orderBy: [messages.createdAt],
  });
  return { thread, messages: rows };
}

export async function createThread(opts: {
  tenantId: string;
  subject: string;
  body: string;
  senderUserId: string;
  senderRole: Viewer;
  subscriptionId?: string | null;
}) {
  const [thread] = await db
    .insert(messageThreads)
    .values({
      tenantId: opts.tenantId,
      subscriptionId: opts.subscriptionId ?? null,
      subject: opts.subject,
      lastMessageBy: opts.senderRole,
    })
    .returning();
  await db.insert(messages).values({
    threadId: thread.id,
    senderUserId: opts.senderUserId,
    senderRole: opts.senderRole,
    body: opts.body,
  });
  return thread;
}

export async function replyToThread(opts: {
  threadId: string;
  body: string;
  senderUserId: string;
  senderRole: Viewer;
}) {
  await db.insert(messages).values({
    threadId: opts.threadId,
    senderUserId: opts.senderUserId,
    senderRole: opts.senderRole,
    body: opts.body,
  });
  await db
    .update(messageThreads)
    .set({ lastMessageAt: new Date(), lastMessageBy: opts.senderRole, status: "open" })
    .where(eq(messageThreads.id, opts.threadId));
}

export async function closeThread(threadId: string) {
  await db.update(messageThreads).set({ status: "closed" }).where(eq(messageThreads.id, threadId));
}
