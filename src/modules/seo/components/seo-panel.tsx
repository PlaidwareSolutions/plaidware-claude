"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Gauge } from "lucide-react";
import type { SeoPanelData } from "../service";
import { cwvVerdict } from "../pagespeed";
import { runSeoRecheckAction, snoozeSeoAction } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function scoreColor(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  return v < 50 ? "text-destructive" : v < 90 ? "text-warning" : "text-success";
}

function verdictColor(v: string): string {
  return v === "good" ? "text-success" : v === "needs-improvement" ? "text-warning" : "text-destructive";
}

function MiniSeries({ data }: { data: (number | null)[] }) {
  const vals = data.map((d) => d ?? 0);
  if (vals.length < 2) return null;
  const pts = vals.map((d, i) => `${(i / (vals.length - 1)) * 100},${30 - (d / 100) * 28}`).join(" ");
  return (
    <svg viewBox="0 0 100 32" className="h-7 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const SCORE_LABELS: [string, string][] = [
  ["performance", "Performance"],
  ["seo", "SEO"],
  ["accessibility", "Accessibility"],
  ["bestPractices", "Best Practices"],
];

const CWV_TILES: { key: string; label: string; metric: "lcp" | "cls" | "inp" | "ttfb"; format: (v: number) => string }[] = [
  { key: "lcpMs", label: "LCP", metric: "lcp", format: (v) => `${(v / 1000).toFixed(1)}s` },
  { key: "clsX1000", label: "CLS", metric: "cls", format: (v) => (v / 1000).toFixed(3) },
  { key: "inpMs", label: "INP", metric: "inp", format: (v) => `${v}ms` },
  { key: "ttfbMs", label: "TTFB", metric: "ttfb", format: (v) => `${v}ms` },
];

export function SeoPanel({
  productName,
  subscriptionId,
  panels,
  opsControls,
}: {
  productName: string;
  subscriptionId: string;
  panels: SeoPanelData[];
  opsControls: boolean;
}) {
  const router = useRouter();
  const [strategy, setStrategy] = useState<string>(panels[0]?.strategy ?? "mobile");
  const [busy, setBusy] = useState(false);
  const panel = panels.find((p) => p.strategy === strategy);

  async function recheck() {
    setBusy(true);
    const res = await runSeoRecheckAction(subscriptionId);
    setBusy(false);
    if (res.ok) {
      toast.success("Audit complete");
      router.refresh();
    } else toast.error(res.error ?? "Recheck failed");
  }

  async function snooze(days: 1 | 3 | 7) {
    const res = await snoozeSeoAction(subscriptionId, strategy as "mobile" | "desktop", days);
    if (res.ok) toast.success(`Alerts snoozed ${days}d — a sharper regression still pages`);
    else toast.error(res.error ?? "Snooze failed");
  }

  const scores = panel ? (panel.latestOk ? panel.latest : (panel.lastGood ?? panel.latest)) : null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="size-4 text-primary" /> SEO — {productName}
        </CardTitle>
        <div className="flex items-center gap-1">
          {panels.map((p) => (
            <Button
              key={p.strategy}
              variant={p.strategy === strategy ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setStrategy(p.strategy)}
            >
              {p.strategy}
            </Button>
          ))}
          {opsControls && (
            <Button variant="outline" size="sm" onClick={recheck} disabled={busy}>
              {busy ? "Auditing…" : "Run now"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!panel && (
          <p className="text-sm text-muted-foreground">
            No audits yet — the daily sweep covers Company Website subscriptions
            with a live domain{opsControls ? ", or use Run now" : ""}.
          </p>
        )}
        {panel && (
          <>
            {!panel.latestOk && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
                Latest audit failed: {panel.latestError ?? "unknown error"}
                {panel.lastGood && " — showing the previous successful run below."}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {SCORE_LABELS.map(([key, label]) => (
                <div key={key} className="rounded-md border p-2 text-center">
                  <div className={`text-2xl font-semibold tabular-nums ${scoreColor(scores?.[key] ?? null)}`}>
                    {scores?.[key] ?? "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                  <MiniSeries data={panel.history.map((h) => h[key as keyof typeof h] ?? null)} />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {CWV_TILES.map((t) => {
                const v = scores?.[t.key];
                const verdict = v != null ? cwvVerdict(t.metric, v) : null;
                return (
                  <div key={t.key} className="rounded-md border p-2 text-center">
                    <div className="text-sm font-semibold tabular-nums text-heading">
                      {v != null ? t.format(v) : "—"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{t.label}</div>
                    {verdict && (
                      <div className={`text-[10px] font-medium uppercase ${verdictColor(verdict)}`}>
                        {verdict.replace("-", " ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Last audit {panel.fetchedAt ? new Date(panel.fetchedAt).toLocaleString() : "—"}</span>
              {opsControls && (
                <span className="flex items-center gap-1">
                  Snooze alerts:
                  {[1, 3, 7].map((d) => (
                    <Button key={d} variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => snooze(d as 1 | 3 | 7)}>
                      {d}d
                    </Button>
                  ))}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
