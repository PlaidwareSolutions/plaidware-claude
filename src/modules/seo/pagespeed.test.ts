import { describe, expect, it } from "vitest";
import {
  breaksThroughSnooze,
  categorySeverity,
  computeAlerts,
  cwvVerdict,
  fetchPageSpeed,
} from "./pagespeed";

describe("fetchPageSpeed parsing", () => {
  it("parses scores and CWVs from a PSI payload", async () => {
    const r = await fetchPageSpeed("acme.com", "mobile", "k", async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        lighthouseResult: {
          categories: {
            performance: { score: 0.92 },
            seo: { score: 1 },
            accessibility: { score: 0.87 },
            "best-practices": { score: 0.79 },
          },
          audits: {
            "largest-contentful-paint": { numericValue: 2412.7 },
            "cumulative-layout-shift": { numericValue: 0.083 },
            "server-response-time": { numericValue: 412.2 },
          },
        },
        loadingExperience: { metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 173 } } },
      }),
    }));
    expect(r).toMatchObject({
      ok: true, performance: 92, seo: 100, accessibility: 87, bestPractices: 79,
      lcpMs: 2413, clsX1000: 83, inpMs: 173, ttfbMs: 412,
    });
  });

  it("failed fetches return ok=false with a message", async () => {
    const r = await fetchPageSpeed("acme.com", "mobile", "k", async () => ({
      ok: false, status: 429, json: async () => ({}),
    }));
    expect(r.ok).toBe(false);
    expect(r.errorMessage).toContain("429");
  });
});

describe("alert math", () => {
  it("severity from drops and low scores", () => {
    expect(categorySeverity(90, 95)).toBe(0); // small drop, fine score
    expect(categorySeverity(70, 95)).toBe(25); // 25-pt drop
    expect(categorySeverity(45, null)).toBe(5); // low score, no baseline
    expect(categorySeverity(30, 55)).toBe(25); // drop 25 beats low 20
  });

  it("computeAlerts sorts by severity and skips healthy categories", () => {
    const alerts = computeAlerts(
      { performance: 40, seo: 95, accessibility: 60, bestPractices: 92 },
      { performance: 90, seo: 96, accessibility: 85, bestPractices: 90 },
    );
    expect(alerts.map((a) => a.category)).toEqual(["performance", "accessibility"]);
    expect(alerts[0].severity).toBe(50);
    expect(alerts[1].severity).toBe(25);
  });

  it("snooze breakthrough requires +10 severity", () => {
    expect(breaksThroughSnooze(30, 25)).toBe(false);
    expect(breaksThroughSnooze(35, 25)).toBe(true);
  });

  it("CWV verdicts use standard bands", () => {
    expect(cwvVerdict("lcp", 2400)).toBe("good");
    expect(cwvVerdict("lcp", 3000)).toBe("needs-improvement");
    expect(cwvVerdict("cls", 300)).toBe("poor");
    expect(cwvVerdict("inp", 150)).toBe("good");
    expect(cwvVerdict("ttfb", 2000)).toBe("poor");
  });
});
