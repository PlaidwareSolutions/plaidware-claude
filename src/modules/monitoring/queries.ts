import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { organization } from "../auth/schema";
import { subscriptions } from "../billing/schema";
import { products } from "../catalog/schema";
import { subscriptionProvisioning } from "../provisioning/schema";
import { nextDailyRunUtc, nextIntervalRunUtc } from "../../lib/schedule";
import { BILLING_SCHEDULE } from "../billing/schedule";
import { seoOverview, type SeoOverviewRow } from "../seo/service";
import { summarizeIngestEvents, type IngestHealth } from "./ingest-health-logic";
import { COSTS_SCHEDULE, MONITORING_SCHEDULE, SEO_SCHEDULE } from "./schedule";
import { healthChecks, ingestKeys } from "./schema";
import {
  findQuietReporters,
  getActiveIncidents,
  lastObservedRuns,
  latestHealthBySubscription,
  listRecentIngestEvents,
  subscriptionKpis,
  subscriptionUptime,
  uptimeBySubscription,
  type Incident,
  type KpiTile,
  type LatestHealth,
  type QuietReporter,
  type UptimeRollup,
} from "./service";

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

// ---------------------------------------------------------------------------
// Ops → Monitoring board
// ---------------------------------------------------------------------------


export type FleetRow = {
  subscriptionId: string;
  tenantId: string;
  tenantName: string;
  productId: string;
  productName: string;
  productSlug: string;
  status: string;
  domainUrl: string | null;
  latest: LatestHealth | null;
  uptime: UptimeRollup | null;
  ingest: IngestHealth | null;
  quiet: boolean;
};

export type ScheduleRow = { label: string; queue: string; cadence: string; nextAt: string; lastAt: string | null };

export type MonitoringBoard = {
  filter: MonitoringFilter;
  options: { products: { slug: string; name: string }[]; tenants: { id: string; name: string }[] };
  stats: {
    monitored: number;
    incidents: number;
    quiet: number;
    fleetUptimePct: number | null;
    seoAlerts: number;
    ingestErrors: number;
  };
  incidents: Incident[];
  quiet: QuietReporter[];
  fleet: FleetRow[];
  seo: SeoOverviewRow[];
  ingest: (IngestHealth & { tenantId: string; tenantName: string; productId: string; productName: string })[];
  schedule: ScheduleRow[];
};

export type MonitoringFilter = { product?: string; tenant?: string; status?: string; q?: string };

const LIVE = ["active", "trialing", "past_due", "suspended"] as const;

export async function getMonitoringBoard(filter: MonitoringFilter = {}, now = new Date()): Promise<MonitoringBoard> {
  const live = await db
    .select({
      subscriptionId: subscriptions.id,
      tenantId: subscriptions.tenantId,
      tenantName: organization.name,
      productId: subscriptions.productId,
      productName: products.name,
      productSlug: products.slug,
      status: subscriptions.status,
      domainUrl: subscriptionProvisioning.domainUrl,
    })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .innerJoin(organization, eq(subscriptions.tenantId, organization.id))
    .leftJoin(subscriptionProvisioning, eq(subscriptionProvisioning.subscriptionId, subscriptions.id))
    .where(inArray(subscriptions.status, [...LIVE]));

  const ids = live.map((s) => s.subscriptionId);
  const [uptime, latest, incidents, quiet, events, seo, observed] = await Promise.all([
    uptimeBySubscription(ids),
    latestHealthBySubscription(ids),
    getActiveIncidents(),
    findQuietReporters(now),
    listRecentIngestEvents(7),
    seoOverview(now).catch(() => [] as SeoOverviewRow[]),
    lastObservedRuns(),
  ]);
  const ingestBySub = new Map(summarizeIngestEvents(events).map((i) => [i.subscriptionId, i]));
  const quietIds = new Set(quiet.map((q) => q.subscriptionId));

  const needle = filter.q?.trim().toLowerCase();
  const matches = (r: { tenantId: string; tenantName: string; productSlug: string; productName: string }) =>
    (!filter.product || r.productSlug === filter.product) &&
    (!filter.tenant || r.tenantId === filter.tenant) &&
    (!needle || `${r.tenantName} ${r.productName}`.toLowerCase().includes(needle));

  const fleetAll: FleetRow[] = live.map((s) => ({
    ...s,
    latest: latest.get(s.subscriptionId) ?? null,
    uptime: uptime.get(s.subscriptionId) ?? null,
    ingest: ingestBySub.get(s.subscriptionId) ?? null,
    quiet: quietIds.has(s.subscriptionId),
  }));
  const fleet = fleetAll
    .filter(matches)
    .filter((r) => {
      if (!filter.status) return true;
      if (filter.status === "healthy") return r.latest?.status === "healthy";
      if (filter.status === "problem") return (r.latest && r.latest.status !== "healthy") || r.quiet;
      if (filter.status === "no_data") return !r.latest;
      return true;
    })
    .sort((a, b) => {
      const rank = (r: FleetRow) => (r.latest?.status === "down" ? 0 : r.latest?.status === "degraded" ? 1 : r.quiet ? 2 : !r.latest ? 3 : 4);
      return rank(a) - rank(b) || a.tenantName.localeCompare(b.tenantName);
    });

  const subMeta = new Map(live.map((s) => [s.subscriptionId, s]));
  const incidentsF = incidents.filter((i) => {
    const m = subMeta.get(i.subscriptionId);
    return !m || matches(m);
  });
  const quietF = quiet.filter((q) => {
    const m = subMeta.get(q.subscriptionId);
    return !m || matches(m);
  });
  const seoF = seo.filter((r) => {
    const m = subMeta.get(r.subscriptionId);
    return !m || matches(m);
  });
  const ingestRows = [...ingestBySub.values()]
    .map((i) => {
      const m = subMeta.get(i.subscriptionId);
      return m
        ? { ...i, tenantId: m.tenantId, tenantName: m.tenantName, productId: m.productId, productName: m.productName, productSlug: m.productSlug }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .filter(matches);

  const probed = fleetAll.filter((r) => r.uptime && r.uptime.probes > 0);
  const fleetUptimePct = probed.length
    ? Math.round((probed.reduce((s, r) => s + (r.uptime!.uptimePct ?? 0), 0) / probed.length) * 100) / 100
    : null;

  const productOptions = [...new Map(live.map((s) => [s.productSlug, s.productName]))]
    .map(([slug, name]) => ({ slug, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const tenantOptions = [...new Map(live.map((s) => [s.tenantId, s.tenantName]))]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    filter,
    options: { products: productOptions, tenants: tenantOptions },
    stats: {
      monitored: fleetAll.filter((r) => r.domainUrl).length,
      incidents: incidents.length,
      quiet: quiet.length,
      fleetUptimePct,
      seoAlerts: seo.filter((r) => r.alerts.length > 0 && !r.snoozedUntil).length,
      ingestErrors: [...ingestBySub.values()].reduce((s, i) => s + i.errors, 0),
    },
    incidents: incidentsF,
    quiet: quietF,
    fleet,
    seo: seoF,
    ingest: ingestRows,
    schedule: [
      {
        label: "Uptime probe",
        queue: MONITORING_SCHEDULE.uptimeProbe.queue,
        cadence: `every ${MONITORING_SCHEDULE.uptimeProbe.everyMinutes} min`,
        nextAt: nextIntervalRunUtc(MONITORING_SCHEDULE.uptimeProbe.everyMinutes, now).toISOString(),
        lastAt: observed.probeAt,
      },
      {
        label: "Quiet-reporter digest",
        queue: MONITORING_SCHEDULE.quietReporters.queue,
        cadence: "daily",
        nextAt: nextDailyRunUtc(MONITORING_SCHEDULE.quietReporters.hourUtc, now).toISOString(),
        lastAt: null,
      },
      {
        label: "SEO sweep (PageSpeed)",
        queue: SEO_SCHEDULE.sweep.queue,
        cadence: "daily",
        nextAt: nextDailyRunUtc(SEO_SCHEDULE.sweep.hourUtc, now).toISOString(),
        lastAt: seo.reduce<string | null>((m, r) => (r.lastAuditAt && (!m || r.lastAuditAt > m) ? r.lastAuditAt : m), null),
      },
      {
        label: "Dunning sweep",
        queue: BILLING_SCHEDULE.dunningSweep.queue,
        cadence: "daily",
        nextAt: nextDailyRunUtc(BILLING_SCHEDULE.dunningSweep.hourUtc, now).toISOString(),
        lastAt: null,
      },
      {
        label: "Railway cost sync",
        queue: COSTS_SCHEDULE.railwaySync.queue,
        cadence: "daily",
        nextAt: nextDailyRunUtc(COSTS_SCHEDULE.railwaySync.hourUtc, now).toISOString(),
        lastAt: null,
      },
      {
        label: "Time-series prune",
        queue: MONITORING_SCHEDULE.prune.queue,
        cadence: "daily",
        nextAt: nextDailyRunUtc(MONITORING_SCHEDULE.prune.hourUtc, now, MONITORING_SCHEDULE.prune.minuteUtc).toISOString(),
        lastAt: null,
      },
    ],
  };
}
