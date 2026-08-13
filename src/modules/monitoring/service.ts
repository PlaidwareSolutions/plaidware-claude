import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import { subscriptions } from "../billing/schema";
import { subscriptionProvisioning } from "../provisioning/schema";
import { products } from "../catalog/schema";
import {
  healthChecks,
  incidentAcks,
  ingestKeys,
  metricIngestEvents,
  productMetricDefinitions,
  usageRecords,
} from "./schema";
import { partitionEvents, type IngestEvent } from "./ingest-logic";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------
// Ingest keys — hashed at rest, raw shown exactly once (PRD §4.8)
// ---------------------------------------------------------------------------

export async function mintIngestKey(subscriptionId: string): Promise<string> {
  const raw = `pwk_${randomBytes(24).toString("hex")}`;
  await db.transaction(async (tx) => {
    await tx
      .update(ingestKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(ingestKeys.subscriptionId, subscriptionId), isNull(ingestKeys.revokedAt)));
    await tx.insert(ingestKeys).values({
      subscriptionId,
      prefix: raw.slice(0, 12),
      keyHash: sha256(raw),
    });
  });
  return raw;
}

export async function resolveIngestKey(rawKey: string) {
  const row = await db.query.ingestKeys.findFirst({
    where: and(eq(ingestKeys.keyHash, sha256(rawKey)), isNull(ingestKeys.revokedAt)),
  });
  if (!row) return null;
  return db.query.subscriptions.findFirst({ where: eq(subscriptions.id, row.subscriptionId) });
}

// ---------------------------------------------------------------------------
// Ingest processing
// ---------------------------------------------------------------------------

export async function processIngest(
  sub: typeof subscriptions.$inferSelect,
  events: IngestEvent[],
): Promise<{ accepted: number; unknownKeys: string[] }> {
  const defs = await db.query.productMetricDefinitions.findMany({
    where: eq(productMetricDefinitions.productId, sub.productId),
    columns: { key: true },
  });
  const p = partitionEvents(events, new Set(defs.map((d) => d.key)));

  if (p.health) {
    await db.insert(healthChecks).values({
      subscriptionId: sub.id,
      source: "reporter",
      status: p.health.status,
      responseTimeMs: p.health.responseTimeMs,
    });
  }
  if (p.business.length > 0) {
    await db.insert(usageRecords).values(
      p.business.map((b) => ({
        tenantId: sub.tenantId,
        subscriptionId: sub.id,
        productId: sub.productId,
        metricKey: b.metric,
        quantity: b.quantity,
        unit: b.unit,
      })),
    );
  }
  return { accepted: (p.health ? 1 : 0) + p.business.length, unknownKeys: p.unknownKeys };
}

export async function logIngestEvent(entry: {
  subscriptionId: string;
  ok: boolean;
  statusCode: number;
  errorMessage?: string | null;
  unknownKeys?: string[];
}): Promise<void> {
  await db
    .insert(metricIngestEvents)
    .values({
      subscriptionId: entry.subscriptionId,
      ok: entry.ok,
      statusCode: entry.statusCode,
      errorMessage: entry.errorMessage ?? null,
      unknownKeys: entry.unknownKeys ?? [],
    })
    .catch(() => {}); // audit is best-effort, never blocks the response
}

// ---------------------------------------------------------------------------
// Uptime probe (worker, every 5 min)
// ---------------------------------------------------------------------------

export async function runUptimeProbe(): Promise<{ probed: number; down: number }> {
  const targets = await db
    .select({
      subscriptionId: subscriptions.id,
      domainUrl: subscriptionProvisioning.domainUrl,
    })
    .from(subscriptions)
    .innerJoin(
      subscriptionProvisioning,
      eq(subscriptionProvisioning.subscriptionId, subscriptions.id),
    )
    .where(
      and(
        inArray(subscriptions.status, ["active", "trialing", "past_due"]),
        sql`${subscriptionProvisioning.domainUrl} is not null`,
      ),
    );

  let down = 0;
  await Promise.all(
    targets.map(async (t) => {
      const base = t.domainUrl!.includes("://") ? t.domainUrl! : `https://${t.domainUrl}`;
      const started = Date.now();
      let status = "down";
      let statusCode: number | null = null;
      let detail: string | null = null;
      try {
        const res = await fetch(`${base.replace(/\/$/, "")}/api/system/health`, {
          signal: AbortSignal.timeout(10_000),
          headers: { "User-Agent": "Plaidware-Uptime/1.0" },
        });
        statusCode = res.status;
        status = res.ok ? "healthy" : res.status >= 500 ? "down" : "degraded";
      } catch (e) {
        detail = e instanceof Error ? e.message.slice(0, 200) : "fetch failed";
      }
      if (status === "down") down++;
      await db.insert(healthChecks).values({
        subscriptionId: t.subscriptionId,
        source: "probe",
        status,
        statusCode,
        responseTimeMs: Date.now() - started,
        detail,
      });
    }),
  );
  return { probed: targets.length, down };
}

// ---------------------------------------------------------------------------
// Incidents — ack pinned to the specific failing check (PRD §4.8)
// ---------------------------------------------------------------------------

export type Incident = {
  subscriptionId: string;
  healthCheckId: string;
  tenantId: string;
  productName: string;
  status: string;
  source: string;
  detail: string | null;
  since: string;
};

export async function getActiveIncidents(): Promise<Incident[]> {
  const latest = await db
    .selectDistinctOn([healthChecks.subscriptionId], {
      id: healthChecks.id,
      subscriptionId: healthChecks.subscriptionId,
      status: healthChecks.status,
      source: healthChecks.source,
      detail: healthChecks.detail,
      createdAt: healthChecks.createdAt,
    })
    .from(healthChecks)
    .orderBy(healthChecks.subscriptionId, desc(healthChecks.createdAt));

  const failing = latest.filter((l) => l.status === "down" || l.status === "degraded");
  if (failing.length === 0) return [];

  const acks = await db.query.incidentAcks.findMany({
    where: inArray(incidentAcks.healthCheckId, failing.map((f) => f.id)),
    columns: { healthCheckId: true },
  });
  const acked = new Set(acks.map((a) => a.healthCheckId));
  const open = failing.filter((f) => !acked.has(f.id));
  if (open.length === 0) return [];

  const subs = await db
    .select({
      id: subscriptions.id,
      tenantId: subscriptions.tenantId,
      productName: products.name,
    })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .where(inArray(subscriptions.id, open.map((o) => o.subscriptionId)));

  return open.map((o) => {
    const s = subs.find((x) => x.id === o.subscriptionId);
    return {
      subscriptionId: o.subscriptionId,
      healthCheckId: o.id,
      tenantId: s?.tenantId ?? "",
      productName: s?.productName ?? "Unknown",
      status: o.status,
      source: o.source,
      detail: o.detail,
      since: o.createdAt.toISOString(),
    };
  });
}

export async function acknowledgeIncident(
  healthCheckId: string,
  subscriptionId: string,
  userId: string,
  note?: string,
): Promise<void> {
  await db
    .insert(incidentAcks)
    .values({ healthCheckId, subscriptionId, acknowledgedByUserId: userId, note: note ?? null })
    .onConflictDoNothing({ target: incidentAcks.healthCheckId });
}

// ---------------------------------------------------------------------------
// Retention prunes + quiet reporters (worker, daily)
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

export async function pruneTimeSeries(now = new Date()): Promise<Record<string, number>> {
  const [h, u, e] = await Promise.all([
    db.delete(healthChecks).where(lt(healthChecks.createdAt, new Date(now.getTime() - 90 * DAY))),
    db.delete(usageRecords).where(lt(usageRecords.recordedAt, new Date(now.getTime() - 395 * DAY))),
    db
      .delete(metricIngestEvents)
      .where(lt(metricIngestEvents.createdAt, new Date(now.getTime() - 7 * DAY))),
  ]);
  return { healthChecks: h.rowCount ?? 0, usageRecords: u.rowCount ?? 0, ingestEvents: e.rowCount ?? 0 };
}

export type QuietReporter = {
  subscriptionId: string;
  tenantId: string;
  productName: string;
  lastSeen: string | null;
  thresholdMinutes: number;
};

export async function findQuietReporters(now = new Date()): Promise<QuietReporter[]> {
  const live = await db
    .select({
      id: subscriptions.id,
      tenantId: subscriptions.tenantId,
      productName: products.name,
      quietAfter: products.reporterQuietAfterMinutes,
    })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .where(inArray(subscriptions.status, ["active", "past_due"]));
  if (live.length === 0) return [];

  const recent = await db
    .select({
      subscriptionId: usageRecords.subscriptionId,
      last: sql<Date>`max(${usageRecords.recordedAt})`,
    })
    .from(usageRecords)
    .where(inArray(usageRecords.subscriptionId, live.map((l) => l.id)))
    .groupBy(usageRecords.subscriptionId);

  const lastBySub = new Map(recent.map((r) => [r.subscriptionId, new Date(r.last)]));
  return live
    .map((l) => {
      const threshold = l.quietAfter ?? 1440;
      const last = lastBySub.get(l.id) ?? null;
      const quiet = !last || now.getTime() - last.getTime() > threshold * 60_000;
      return quiet
        ? {
            subscriptionId: l.id,
            tenantId: l.tenantId,
            productName: l.productName,
            lastSeen: last?.toISOString() ?? null,
            thresholdMinutes: threshold,
          }
        : null;
    })
    .filter((x): x is QuietReporter => x !== null);
}

// ---------------------------------------------------------------------------
// Rollups for UI
// ---------------------------------------------------------------------------

export async function subscriptionUptime(subscriptionId: string, days = 30) {
  const since = new Date(Date.now() - days * DAY);
  const rows = await db.query.healthChecks.findMany({
    where: and(
      eq(healthChecks.subscriptionId, subscriptionId),
      eq(healthChecks.source, "probe"),
      gte(healthChecks.createdAt, since),
    ),
    columns: { status: true, responseTimeMs: true },
  });
  const total = rows.length;
  const healthy = rows.filter((r) => r.status === "healthy").length;
  const rts = rows.map((r) => r.responseTimeMs).filter((x): x is number => x != null);
  return {
    probes: total,
    uptimePct: total ? Math.round((healthy / total) * 10000) / 100 : null,
    avgResponseMs: rts.length ? Math.round(rts.reduce((s, x) => s + x, 0) / rts.length) : null,
  };
}

export type KpiTile = {
  key: string;
  label: string;
  unit: string | null;
  aggregation: string;
  direction: string;
  isPrimary: boolean;
  current: number | null;
  previous: number | null;
  series: number[]; // last `windowDays` daily buckets
};

export async function subscriptionKpis(
  subscriptionId: string,
  productId: string,
  windowDays = 30,
): Promise<KpiTile[]> {
  const defs = await db.query.productMetricDefinitions.findMany({
    where: eq(productMetricDefinitions.productId, productId),
    orderBy: [productMetricDefinitions.displayOrder],
  });
  if (defs.length === 0) return [];
  const since = new Date(Date.now() - 2 * windowDays * DAY);
  const rows = await db.query.usageRecords.findMany({
    where: and(eq(usageRecords.subscriptionId, subscriptionId), gte(usageRecords.recordedAt, since)),
    columns: { metricKey: true, quantity: true, recordedAt: true },
  });
  const cutoff = Date.now() - windowDays * DAY;

  return defs.map((d) => {
    const mine = rows.filter((r) => r.metricKey === d.key);
    const agg = (xs: number[]) =>
      xs.length === 0
        ? null
        : d.aggregation === "avg"
          ? xs.reduce((s, x) => s + x, 0) / xs.length
          : d.aggregation === "max"
            ? Math.max(...xs)
            : d.aggregation === "last"
              ? xs[xs.length - 1]
              : xs.reduce((s, x) => s + x, 0);
    const cur = mine.filter((r) => r.recordedAt.getTime() >= cutoff);
    const prev = mine.filter((r) => r.recordedAt.getTime() < cutoff);
    const series: number[] = [];
    for (let i = windowDays - 1; i >= 0; i--) {
      const dayStart = Date.now() - (i + 1) * DAY;
      const dayEnd = Date.now() - i * DAY;
      const day = cur.filter(
        (r) => r.recordedAt.getTime() >= dayStart && r.recordedAt.getTime() < dayEnd,
      );
      series.push(agg(day.map((r) => r.quantity)) ?? 0);
    }
    return {
      key: d.key,
      label: d.label,
      unit: d.unit,
      aggregation: d.aggregation,
      direction: d.direction,
      isPrimary: d.isPrimary,
      current: agg(cur.map((r) => r.quantity)),
      previous: agg(prev.map((r) => r.quantity)),
      series,
    };
  });
}
