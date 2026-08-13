/** PageSpeed Insights v5 fetcher + alert math — fetcher injectable for tests. */

export type PsiResult = {
  ok: boolean;
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  lcpMs: number | null;
  clsX1000: number | null;
  inpMs: number | null;
  ttfbMs: number | null;
  errorMessage: string | null;
};

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function fetchPageSpeed(
  siteUrl: string,
  strategy: "mobile" | "desktop",
  apiKey: string,
  fetcher: Fetcher = fetch,
): Promise<PsiResult> {
  const target = siteUrl.includes("://") ? siteUrl : `https://${siteUrl}`;
  const qs = new URLSearchParams({ url: target, strategy, key: apiKey });
  for (const c of ["performance", "seo", "accessibility", "best-practices"]) {
    qs.append("category", c);
  }
  const fail = (msg: string): PsiResult => ({
    ok: false, performance: null, seo: null, accessibility: null, bestPractices: null,
    lcpMs: null, clsX1000: null, inpMs: null, ttfbMs: null, errorMessage: msg,
  });
  try {
    const res = await fetcher(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`);
    if (!res.ok) return fail(`PSI HTTP ${res.status}`);
    const data = (await res.json()) as {
      lighthouseResult?: {
        categories?: Record<string, { score?: number | null }>;
        audits?: Record<string, { numericValue?: number }>;
      };
      loadingExperience?: { metrics?: Record<string, { percentile?: number }> };
    };
    const cats = data.lighthouseResult?.categories ?? {};
    const audits = data.lighthouseResult?.audits ?? {};
    const score = (k: string) =>
      cats[k]?.score != null ? Math.round(cats[k].score! * 100) : null;
    const num = (k: string) => audits[k]?.numericValue ?? null;
    const inp =
      data.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile ??
      num("interaction-to-next-paint");
    return {
      ok: true,
      performance: score("performance"),
      seo: score("seo"),
      accessibility: score("accessibility"),
      bestPractices: score("best-practices"),
      lcpMs: num("largest-contentful-paint") != null ? Math.round(num("largest-contentful-paint")!) : null,
      clsX1000: num("cumulative-layout-shift") != null ? Math.round(num("cumulative-layout-shift")! * 1000) : null,
      inpMs: inp != null ? Math.round(inp) : null,
      ttfbMs: num("server-response-time") != null ? Math.round(num("server-response-time")!) : null,
      errorMessage: null,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message.slice(0, 200) : "fetch failed");
  }
}

// ---------------------------------------------------------------------------
// Alert math (PRD §4.9): drop ≥20 vs a ≥7-day-old baseline, or score <50.
// ---------------------------------------------------------------------------

export const CATEGORIES = ["performance", "seo", "accessibility", "bestPractices"] as const;
export type Category = (typeof CATEGORIES)[number];

export type CategoryAlert = { category: Category; current: number; baseline: number | null; severity: number };

export function categorySeverity(current: number, baseline: number | null): number {
  const drop = baseline != null ? baseline - current : 0;
  const dropSeverity = drop >= 20 ? drop : 0;
  const lowSeverity = current < 50 ? 50 - current : 0;
  return Math.max(dropSeverity, lowSeverity);
}

export function computeAlerts(
  latest: Partial<Record<Category, number | null>>,
  baseline: Partial<Record<Category, number | null>>,
): CategoryAlert[] {
  const out: CategoryAlert[] = [];
  for (const c of CATEGORIES) {
    const cur = latest[c];
    if (cur == null) continue;
    const base = baseline[c] ?? null;
    const severity = categorySeverity(cur, base);
    if (severity > 0) out.push({ category: c, current: cur, baseline: base, severity });
  }
  return out.sort((a, b) => b.severity - a.severity);
}

export const SNOOZE_BREAKTHROUGH_DELTA = 10;

/** A snoozed alert still pages when materially worse than at snooze time. */
export function breaksThroughSnooze(worstSeverity: number, severityAtSnooze: number): boolean {
  return worstSeverity >= severityAtSnooze + SNOOZE_BREAKTHROUGH_DELTA;
}

/** Standard Lighthouse CWV verdicts (good | needs-improvement | poor). */
export function cwvVerdict(metric: "lcp" | "cls" | "inp" | "ttfb", value: number): string {
  const bands: Record<string, [number, number]> = {
    lcp: [2500, 4000],
    cls: [100, 250], // x1000
    inp: [200, 500],
    ttfb: [800, 1800],
  };
  const [good, ni] = bands[metric];
  return value <= good ? "good" : value <= ni ? "needs-improvement" : "poor";
}
