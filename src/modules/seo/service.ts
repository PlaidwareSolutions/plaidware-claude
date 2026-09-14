import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import { env } from "../../env";
import { emailShell, sendEmail } from "../../lib/email";
import { products } from "../catalog/schema";
import { subscriptions } from "../billing/schema";
import { organization } from "../auth/schema";
import { subscriptionProvisioning } from "../provisioning/schema";
import { seoAudits, seoSnoozes } from "./schema";
import {
  breaksThroughSnooze,
  computeAlerts,
  fetchPageSpeed,
  type Category,
} from "./pagespeed";

const DAY = 86_400_000;
const STRATEGIES = ["mobile", "desktop"] as const;

async function seoTargets() {
  return db
    .select({
      subscriptionId: subscriptions.id,
      tenantId: subscriptions.tenantId,
      tenantName: organization.name,
      domainUrl: subscriptionProvisioning.domainUrl,
    })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .innerJoin(subscriptionProvisioning, eq(subscriptionProvisioning.subscriptionId, subscriptions.id))
    .innerJoin(organization, eq(organization.id, subscriptions.tenantId))
    .where(
      and(
        eq(products.slug, "company-website"),
        inArray(subscriptions.status, ["active", "trialing", "past_due"]),
        sql`${subscriptionProvisioning.domainUrl} is not null`,
      ),
    );
}

export async function auditOneSubscription(subscriptionId: string, domainUrl: string) {
  if (!env.PAGESPEED_INSIGHTS_API_KEY) throw new Error("pagespeed_not_configured");
  await Promise.allSettled(
    STRATEGIES.map(async (strategy) => {
      const r = await fetchPageSpeed(domainUrl, strategy, env.PAGESPEED_INSIGHTS_API_KEY!);
      await db.insert(seoAudits).values({
        subscriptionId,
        strategy,
        performance: r.performance,
        seo: r.seo,
        accessibility: r.accessibility,
        bestPractices: r.bestPractices,
        lcpMs: r.lcpMs,
        clsX1000: r.clsX1000,
        inpMs: r.inpMs,
        ttfbMs: r.ttfbMs,
        ok: r.ok,
        errorMessage: r.errorMessage,
      });
    }),
  );
}

export async function runSeoSweep(): Promise<{ audited: number; failed: number }> {
  if (!env.PAGESPEED_INSIGHTS_API_KEY) return { audited: 0, failed: 0 };
  const targets = await seoTargets();
  let failed = 0;
  for (const t of targets) {
    try {
      await auditOneSubscription(t.subscriptionId, t.domainUrl!);
    } catch {
      failed++;
    }
    await new Promise((r) => setTimeout(r, 300)); // stay under PSI free-tier QPS
  }
  // 12-month retention (PRD §4.9)
  await db.delete(seoAudits).where(lt(seoAudits.fetchedAt, new Date(Date.now() - 365 * DAY)));
  await runSeoAlertDigest();
  return { audited: targets.length, failed };
}

const CAT_FIELDS: Record<Category, "performance" | "seo" | "accessibility" | "bestPractices"> = {
  performance: "performance",
  seo: "seo",
  accessibility: "accessibility",
  bestPractices: "bestPractices",
};

export type SeoAlertRow = {
  subscriptionId: string;
  tenantId: string;
  tenantName: string;
  domainUrl: string | null;
  strategy: string;
  alerts: { category: string; current: number; baseline: number | null; severity: number; reasons: string[] }[];
  /** Set when a snooze is holding this row back from the digest. */
  snoozedUntil: string | null;
};

/**
 * One code path for "what would page ops right now": latest good audit per
 * strategy vs the ≥7-day-old baseline, minus active snoozes (unless the
 * regression breaks through). The digest emails it; the board renders it.
 */
export async function collectSeoAlerts(now = new Date(), opts: { includeSnoozed?: boolean } = {}): Promise<SeoAlertRow[]> {
  const targets = await seoTargets();
  const rows: SeoAlertRow[] = [];

  for (const t of targets) {
    for (const strategy of STRATEGIES) {
      const good = await db.query.seoAudits.findMany({
        where: and(
          eq(seoAudits.subscriptionId, t.subscriptionId),
          eq(seoAudits.strategy, strategy),
          eq(seoAudits.ok, true),
          gte(seoAudits.fetchedAt, new Date(now.getTime() - 14 * DAY)),
        ),
        orderBy: [desc(seoAudits.fetchedAt)],
      });
      const latest = good[0];
      if (!latest) continue;
      const baseline = good.find(
        (g) => latest.fetchedAt.getTime() - g.fetchedAt.getTime() >= 7 * DAY,
      );
      const pick = (a: typeof latest | undefined) =>
        Object.fromEntries(
          Object.entries(CAT_FIELDS).map(([c, f]) => [c, a?.[f] ?? null]),
        ) as Partial<Record<Category, number | null>>;
      const alerts = computeAlerts(pick(latest), pick(baseline));
      if (alerts.length === 0) continue;

      const snooze = await db.query.seoSnoozes.findFirst({
        where: and(eq(seoSnoozes.tenantId, t.tenantId), eq(seoSnoozes.strategy, strategy)),
      });
      const worst = alerts[0].severity;
      const held = Boolean(snooze && snooze.snoozedUntil > now && !breaksThroughSnooze(worst, snooze.severityAtSnooze));
      if (held && !opts.includeSnoozed) continue;
      rows.push({
        subscriptionId: t.subscriptionId,
        tenantId: t.tenantId,
        tenantName: t.tenantName,
        domainUrl: t.domainUrl,
        strategy,
        alerts,
        snoozedUntil: held ? snooze!.snoozedUntil.toISOString() : null,
      });
    }
  }
  return rows;
}

export async function runSeoAlertDigest(now = new Date()): Promise<number> {
  if (!env.OPS_EMAIL) return 0;
  const rows = await collectSeoAlerts(now);

  if (rows.length > 0) {
    // "below 50" is a floor alert, not a regression — a score can improve and
    // still alert. Label each finding so the email reads correctly either way.
    const reasonLabel = (reasons: string[]) =>
      reasons.map((x) => (x === "drop" ? "dropped ≥20" : "below 50")).join(", ");
    await sendEmail({
      to: env.OPS_EMAIL,
      subject: `[Plaidware ops] ${rows.length} SEO alert${rows.length === 1 ? "" : "s"}`,
      html: emailShell(
        "SEO alerts",
        rows
          .map(
            (r) =>
              `<p><strong>${r.tenantName}</strong>${r.domainUrl ? ` (${r.domainUrl})` : ""} — <strong>${r.strategy}</strong> — ` +
              r.alerts
                .map(
                  (a) =>
                    `${a.category}: ${a.current}${a.baseline != null ? ` (was ${a.baseline})` : ""} [${reasonLabel(a.reasons)}]`,
                )
                .join(" · ") +
              `</p>`,
          )
          .join(""),
      ),
    });
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Panel data
// ---------------------------------------------------------------------------

export type SeoPanelData = {
  subscriptionId: string;
  strategy: string;
  latest: Record<string, number | null> & { ok?: number | null };
  latestOk: boolean;
  latestError: string | null;
  lastGood: Record<string, number | null> | null;
  fetchedAt: string | null;
  history: { performance: number | null; seo: number | null; accessibility: number | null; bestPractices: number | null }[];
};

export async function seoPanelData(subscriptionId: string): Promise<SeoPanelData[]> {
  const out: SeoPanelData[] = [];
  for (const strategy of STRATEGIES) {
    const rows = await db.query.seoAudits.findMany({
      where: and(eq(seoAudits.subscriptionId, subscriptionId), eq(seoAudits.strategy, strategy)),
      orderBy: [desc(seoAudits.fetchedAt)],
      limit: 30,
    });
    const latest = rows[0];
    if (!latest) continue;
    const lastGood = latest.ok ? latest : rows.find((r) => r.ok);
    const flat = (a: typeof latest | undefined | null) =>
      a
        ? {
            performance: a.performance, seo: a.seo, accessibility: a.accessibility,
            bestPractices: a.bestPractices, lcpMs: a.lcpMs, clsX1000: a.clsX1000,
            inpMs: a.inpMs, ttfbMs: a.ttfbMs,
          }
        : null;
    out.push({
      subscriptionId,
      strategy,
      latest: flat(latest)!,
      latestOk: latest.ok,
      latestError: latest.errorMessage,
      lastGood: latest.ok ? null : flat(lastGood),
      fetchedAt: latest.fetchedAt.toISOString(),
      history: [...rows].reverse().map((r) => ({
        performance: r.performance, seo: r.seo, accessibility: r.accessibility, bestPractices: r.bestPractices,
      })),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Board overview — every audited site with its latest scores and alert state
// ---------------------------------------------------------------------------

export type SeoOverviewRow = {
  subscriptionId: string;
  tenantId: string;
  tenantName: string;
  domainUrl: string | null;
  lastAuditAt: string | null;
  scores: Record<"mobile" | "desktop", { performance: number | null; seo: number | null; ok: boolean } | null>;
  alerts: SeoAlertRow["alerts"];
  worstSeverity: number;
  snoozedUntil: string | null;
};

export async function seoOverview(now = new Date()): Promise<SeoOverviewRow[]> {
  const [targets, alertRows] = await Promise.all([seoTargets(), collectSeoAlerts(now, { includeSnoozed: true })]);
  const out: SeoOverviewRow[] = [];
  for (const t of targets) {
    const latest = await db
      .selectDistinctOn([seoAudits.strategy], {
        strategy: seoAudits.strategy,
        performance: seoAudits.performance,
        seo: seoAudits.seo,
        ok: seoAudits.ok,
        fetchedAt: seoAudits.fetchedAt,
      })
      .from(seoAudits)
      .where(eq(seoAudits.subscriptionId, t.subscriptionId))
      .orderBy(seoAudits.strategy, desc(seoAudits.fetchedAt));
    const mine = alertRows.filter((r) => r.subscriptionId === t.subscriptionId);
    const alerts = mine.flatMap((r) => r.alerts).sort((a, b) => b.severity - a.severity);
    const pick = (s: "mobile" | "desktop") => {
      const row = latest.find((l) => l.strategy === s);
      return row ? { performance: row.performance, seo: row.seo, ok: row.ok } : null;
    };
    out.push({
      subscriptionId: t.subscriptionId,
      tenantId: t.tenantId,
      tenantName: t.tenantName,
      domainUrl: t.domainUrl,
      lastAuditAt: latest.length ? new Date(Math.max(...latest.map((l) => l.fetchedAt.getTime()))).toISOString() : null,
      scores: { mobile: pick("mobile"), desktop: pick("desktop") },
      alerts,
      worstSeverity: alerts[0]?.severity ?? 0,
      snoozedUntil: mine.find((r) => r.snoozedUntil)?.snoozedUntil ?? null,
    });
  }
  return out.sort((a, b) => b.worstSeverity - a.worstSeverity || a.tenantName.localeCompare(b.tenantName));
}

/** Latest audit timestamp (any strategy) — the manual recheck cooldown source. */
export async function lastAuditAt(subscriptionId: string): Promise<Date | null> {
  const row = await db.query.seoAudits.findFirst({
    where: eq(seoAudits.subscriptionId, subscriptionId),
    orderBy: [desc(seoAudits.fetchedAt)],
    columns: { fetchedAt: true },
  });
  return row?.fetchedAt ?? null;
}
