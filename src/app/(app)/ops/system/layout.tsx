import { env } from "@/env";
import { PageHeader } from "@/components/page-header";
import { LinkTabs } from "@/components/link-tabs";
import { OPS } from "@/lib/routes";
import { countDeadDeliveries } from "@/modules/webhooks_out/queries";

export const dynamic = "force-dynamic";

export default async function SystemLayout({ children }: { children: React.ReactNode }) {
  const dead = await countDeadDeliveries();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="System" description="Platform access, integrations, hosting costs, and promotions.">
        <LinkTabs
          items={[
            { href: OPS.access, label: "Access" },
            { href: OPS.webhooks, label: "Webhooks", count: dead },
            { href: OPS.costs, label: "Costs" },
            ...(env.PROMOS_ENABLED === "true" ? [{ href: OPS.promos, label: "Promos" }] : []),
          ]}
        />
      </PageHeader>
      {children}
    </div>
  );
}
