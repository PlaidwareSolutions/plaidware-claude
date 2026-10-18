import { requireTenantPage } from "@/policy";
import { getThreadWithMessages, listThreads } from "@/modules/messaging/service";
import { InboxView } from "@/modules/messaging/components/inbox-view";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const { active, caps } = await requireTenantPage();

  const { thread: threadId } = await searchParams;
  const threads = await listThreads("tenant", active.id);
  // Messaging stays open while suspended or inactive; only a view-as session is read-only here.
  const detail =
    threadId && threads.some((t) => t.id === threadId)
      ? await getThreadWithMessages(threadId, "tenant", { markRead: !caps.locked })
      : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <PageHeader title="Messages" description="Conversations with the Plaidware team." />
      <InboxView
        scope="tenant"
        tenantId={active.id}
        threads={threads}
        activeThread={threads.find((t) => t.id === threadId) ?? null}
        activeMessages={detail?.messages ?? []}
        readOnlyReason={caps.locked ? caps.readOnlyReason : null}
      />
    </div>
  );
}
