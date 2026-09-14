import { PageHeader } from "@/components/page-header";
import { LinkTabs } from "@/components/link-tabs";
import { OPS } from "@/lib/routes";
import { unreadCount } from "@/modules/messaging/service";
import { countNewContactSubmissions } from "@/modules/contact/queries";

export const dynamic = "force-dynamic";

export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const [unread, leads] = await Promise.all([unreadCount("ops"), countNewContactSubmissions()]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Inbox" description="Client conversations and leads from the marketing site.">
        <LinkTabs
          items={[
            { href: OPS.inbox, label: "Messages", exact: true, count: unread },
            { href: OPS.leads, label: "Leads", count: leads },
          ]}
        />
      </PageHeader>
      {children}
    </div>
  );
}
