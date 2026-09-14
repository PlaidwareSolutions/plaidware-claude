import { notFound } from "next/navigation";
import { Activity, Gauge } from "lucide-react";
import { requireOpsPage } from "@/policy";
import { env } from "@/env";
import { listTenantSubscriptions } from "@/modules/billing/queries";
import { listTenantMonitoringCards } from "@/modules/monitoring/queries";
import { findQuietReporters, getActiveIncidents } from "@/modules/monitoring/service";
import { seoPanelData } from "@/modules/seo/service";
import { MonitoringCards } from "@/modules/monitoring/components/monitoring-cards";
import { IncidentsView } from "@/modules/monitoring/components/incidents-view";
import { SeoPanel } from "@/modules/seo/components/seo-panel";
import { Section } from "@/components/section";
import { loadClient, clientMetadata } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return clientMetadata(params, "Monitoring");
}

export default async function ClientMonitoringPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOpsPage();
  const { id } = await params;
  const client = await loadClient(id);
  if (!client) notFound();

  const subs = await listTenantSubscriptions(id);
  const [cards, incidents, quiet] = await Promise.all([
    listTenantMonitoringCards(subs),
    getActiveIncidents({ tenantId: id }),
    findQuietReporters(new Date(), { tenantId: id }),
  ]);
  const seoSubs = subs.filter((s) => s.productSlug === "company-website" && !["canceled", "expired"].includes(s.status));
  const seoPanels = await Promise.all(seoSubs.map(async (s) => ({ sub: s, panels: await seoPanelData(s.id) })));

  return (
    <div className="flex flex-col gap-8">
      <IncidentsView incidents={incidents} quiet={quiet} />
      <Section title="Uptime, KPIs & reporting" icon={Activity} count={cards.length}>
        <MonitoringCards tenantId={id} canWrite ingestUrl={`${env.APP_BASE_URL}/api/metrics/ingest`} cards={cards} />
      </Section>
      {seoPanels.length > 0 && (
        <Section title="SEO & Core Web Vitals" icon={Gauge} count={seoPanels.length}>
          <div className="flex flex-col gap-4">
            {seoPanels.map(({ sub, panels }) => (
              <SeoPanel key={sub.id} productName={sub.productName} subscriptionId={sub.id} panels={panels} opsControls />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
