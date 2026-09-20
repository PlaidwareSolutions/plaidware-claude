import { redirect } from "next/navigation";
import { getSession } from "@/policy";
import { getUserTenants } from "@/modules/tenancy/queries";
import { getThreadWithMessages, listThreads } from "@/modules/messaging/service";
import { InboxView } from "@/modules/messaging/components/inbox-view";
import { PageHeader } from "@/components/page-header";
import { AUTH, TENANT } from "@/lib/routes";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect(AUTH.login);
  const tenants = await getUserTenants(session.user.id);
  const active =
    tenants.find((t) => t.id === session.session.activeOrganizationId) ?? tenants[0];
  if (!active) redirect(TENANT.dashboard);

  const { thread: threadId } = await searchParams;
  const threads = await listThreads("tenant", active.id);
  const detail =
    threadId && threads.some((t) => t.id === threadId)
      ? await getThreadWithMessages(threadId, "tenant")
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
      />
    </div>
  );
}
