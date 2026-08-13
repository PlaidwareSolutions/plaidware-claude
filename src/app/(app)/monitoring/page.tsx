import { redirect } from "next/navigation";
import { eq, and, isNull, desc } from "drizzle-orm";
import { getSession } from "@/policy";
import { db } from "@/db";
import { getUserTenants } from "@/modules/tenancy/queries";
import { listTenantSubscriptions } from "@/modules/billing/queries";
import { healthChecks, ingestKeys } from "@/modules/monitoring/schema";
import { subscriptionKpis, subscriptionUptime } from "@/modules/monitoring/service";
import { env } from "@/env";
import { MonitoringView } from "@/modules/monitoring/components/monitoring-view";
import { seoPanelData } from "@/modules/seo/service";
import { SeoPanel } from "@/modules/seo/components/seo-panel";

export const metadata = { title: "Monitoring" };
export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const tenants = await getUserTenants(session.user.id);
  const active =
    tenants.find((t) => t.id === session.session.activeOrganizationId) ?? tenants[0];
  if (!active) redirect("/dashboard");

  const subs = (await listTenantSubscriptions(active.id)).filter(
    (s) => !["canceled", "expired"].includes(s.status),
  );

  const cards = await Promise.all(
    subs.map(async (s) => {
      const [uptime, kpis, latest, keyRow] = await Promise.all([
        subscriptionUptime(s.id),
        subscriptionKpis(s.id, s.productId),
        db.query.healthChecks.findFirst({
          where: eq(healthChecks.subscriptionId, s.id),
          orderBy: [desc(healthChecks.createdAt)],
        }),
        db.query.ingestKeys.findFirst({
          where: and(eq(ingestKeys.subscriptionId, s.id), isNull(ingestKeys.revokedAt)),
        }),
      ]);
      return {
        subscriptionId: s.id,
        productName: s.productName,
        productColor: s.productColor,
        domainUrl: s.domainUrl,
        latestStatus: latest?.status ?? null,
        uptime,
        kpis,
        keyPrefix: keyRow?.prefix ?? null,
        sampleKeys: kpis.map((k) => k.key),
      };
    }),
  );

  const isOpsUser = session.user.platformRole === "ops_admin";
  const seoSubs = subs.filter((s) => s.productSlug === "company-website");
  const seoPanels = await Promise.all(
    seoSubs.map(async (s) => ({ sub: s, panels: await seoPanelData(s.id) })),
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <MonitoringView
        tenantId={active.id}
        canWrite={["owner", "admin"].includes(active.role) || isOpsUser}
        ingestUrl={`${env.APP_BASE_URL}/api/metrics/ingest`}
        cards={cards}
      />
      {seoPanels.map(({ sub, panels }) => (
        <SeoPanel
          key={sub.id}
          productName={sub.productName}
          subscriptionId={sub.id}
          panels={panels}
          opsControls={isOpsUser}
        />
      ))}
    </div>
  );
}
