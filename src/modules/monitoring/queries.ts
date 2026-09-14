import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { healthChecks, ingestKeys } from "./schema";
import { subscriptionKpis, subscriptionUptime, type KpiTile } from "./service";

/** One monitored subscription as both the client's Monitoring page and the ops client tab render it. */
export type MonitoringCardData = {
  subscriptionId: string;
  productId: string;
  productName: string;
  productColor: string | null;
  domainUrl: string | null;
  latestStatus: string | null;
  uptime: { probes: number; uptimePct: number | null; avgResponseMs: number | null };
  kpis: KpiTile[];
  keyPrefix: string | null;
  sampleKeys: string[];
};

const CLOSED = new Set(["canceled", "expired"]);

export async function listTenantMonitoringCards(
  subs: {
    id: string;
    status: string;
    productId: string;
    productName: string;
    productColor: string | null;
    domainUrl: string | null;
  }[],
): Promise<MonitoringCardData[]> {
  const open = subs.filter((s) => !CLOSED.has(s.status));
  return Promise.all(
    open.map(async (s) => {
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
        productId: s.productId,
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
}
