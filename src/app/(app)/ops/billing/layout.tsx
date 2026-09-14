import { PageHeader } from "@/components/page-header";
import { LinkTabs } from "@/components/link-tabs";
import { OPS } from "@/lib/routes";

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Billing"
        description="Who's paying, what bills next, and whether it will actually collect."
      >
        <LinkTabs
          items={[
            { href: OPS.billing, label: "Board", exact: true },
            { href: OPS.subscriptions, label: "Subscriptions" },
          ]}
        />
      </PageHeader>
      {children}
    </div>
  );
}
