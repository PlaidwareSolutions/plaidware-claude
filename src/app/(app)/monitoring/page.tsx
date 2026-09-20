import { requireTenantPage } from "@/policy";
import { listTenantSubscriptions } from "@/modules/billing/queries";
import { listTenantMonitoringCards } from "@/modules/monitoring/queries";
import { env } from "@/env";
import { MonitoringView } from "@/modules/monitoring/components/monitoring-view";
import { seoPanelData } from "@/modules/seo/service";
import { SeoPanel } from "@/modules/seo/components/seo-panel";

export const metadata = { title: "Monitoring" };
export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
  const { active, caps } = await requireTenantPage();

  const subs = (await listTenantSubscriptions(active.id)).filter(
    (s) => !["canceled", "expired"].includes(s.status),
  );
  const cards = await listTenantMonitoringCards(subs);

  const seoSubs = subs.filter((s) => s.productSlug === "company-website");
  const seoPanels = await Promise.all(
    seoSubs.map(async (s) => ({ sub: s, panels: await seoPanelData(s.id) })),
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <MonitoringView
        tenantId={active.id}
        canWrite={caps.can("write")}
        ingestUrl={`${env.APP_BASE_URL}/api/metrics/ingest`}
        cards={cards}
      />
      {seoPanels.map(({ sub, panels }) => (
        // Ops controls (run now / snooze) live on the ops client page and Monitoring board.
        <SeoPanel key={sub.id} productName={sub.productName} subscriptionId={sub.id} panels={panels} opsControls={false} />
      ))}
    </div>
  );
}
