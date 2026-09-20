import { requireOpsPage } from "@/policy";
import { getThreadWithMessages, listThreads } from "@/modules/messaging/service";
import { getTenant } from "@/modules/tenancy/queries";
import { InboxView } from "@/modules/messaging/components/inbox-view";

export const metadata = { title: "Messages · Inbox" };
export const dynamic = "force-dynamic";

export default async function OpsInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string; tenant?: string }>;
}) {
  await requireOpsPage();

  const { thread: threadId, tenant: tenantId } = await searchParams;
  const [threads, scopedTenant] = await Promise.all([
    listThreads("ops", tenantId || undefined),
    tenantId ? getTenant(tenantId) : Promise.resolve(null),
  ]);
  const detail = threadId ? await getThreadWithMessages(threadId, "ops") : null;

  return (
    <InboxView
      scope="ops"
      tenantId={null}
      filter={scopedTenant ? { tenantId: scopedTenant.id, tenantName: scopedTenant.name } : null}
      threads={threads}
      activeThread={threads.find((t) => t.id === threadId) ?? null}
      activeMessages={detail?.messages ?? []}
    />
  );
}
