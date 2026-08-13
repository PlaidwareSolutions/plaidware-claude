import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { getSession, isOps } from "@/policy";
import { db } from "@/db";
import { user } from "@/modules/auth/schema";
import { getThreadWithMessages, listThreads } from "@/modules/messaging/service";
import { InboxView } from "@/modules/messaging/components/inbox-view";

export const metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

export default async function OpsInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOps(session)) redirect("/dashboard");

  const { thread: threadId } = await searchParams;
  const threads = await listThreads("ops");
  const detail = threadId ? await getThreadWithMessages(threadId, "ops") : null;
  const senderIds = [...new Set((detail?.messages ?? []).map((m) => m.senderUserId).filter((x): x is string => !!x))];
  const senders = senderIds.length
    ? await db.query.user.findMany({ where: inArray(user.id, senderIds), columns: { id: true, name: true } })
    : [];

  return (
    <InboxView
      scope="ops"
      tenantId={null}
      threads={threads}
      activeThread={threads.find((t) => t.id === threadId) ?? null}
      activeMessages={(detail?.messages ?? []).map((m) => ({
        id: m.id,
        senderRole: m.senderRole,
        senderName: senders.find((s) => s.id === m.senderUserId)?.name ?? null,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      }))}
    />
  );
}
