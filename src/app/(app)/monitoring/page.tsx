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

  return (
    <MonitoringView
      tenantId={active.id}
      canWrite={["owner", "admin"].includes(active.role) || session.user.platformRole === "ops_admin"}
      ingestUrl={`${env.APP_BASE_URL}/api/metrics/ingest`}
      cards={cards}
    />
  );
}
