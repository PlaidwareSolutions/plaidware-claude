import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { getSession } from "@/policy";
import { db } from "@/db";
import { user } from "@/modules/auth/schema";
import { getUserTenants } from "@/modules/tenancy/queries";
import { getThreadWithMessages, listThreads } from "@/modules/messaging/service";
import { InboxView } from "@/modules/messaging/components/inbox-view";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const tenants = await getUserTenants(session.user.id);
  const active =
    tenants.find((t) => t.id === session.session.activeOrganizationId) ?? tenants[0];
  if (!active) redirect("/dashboard");

  const { thread: threadId } = await searchParams;
  const threads = await listThreads("tenant", active.id);
  const detail =
    threadId && threads.some((t) => t.id === threadId)
      ? await getThreadWithMessages(threadId, "tenant")
      : null;

  const senderIds = [...new Set((detail?.messages ?? []).map((m) => m.senderUserId).filter((x): x is string => !!x))];
  const senders = senderIds.length
    ? await db.query.user.findMany({ where: inArray(user.id, senderIds), columns: { id: true, name: true } })
    : [];

  return (
    <InboxView
      scope="tenant"
      tenantId={active.id}
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
