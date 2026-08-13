"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Activity, KeyRound, RefreshCw } from "lucide-react";
import { rotateIngestKeyAction } from "../actions";
import type { KpiTile } from "../service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CardData = {
  subscriptionId: string;
  productName: string;
  productColor: string | null;
  domainUrl: string | null;
  latestStatus: string | null;
  uptime: { probes: number; uptimePct: number | null; avgResponseMs: number | null };
  kpis: KpiTile[];
  keyPrefix: string | null;
  sampleKeys: string[];
};

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2 || data.every((d) => d === 0)) {
    return <div className="h-8 text-[10px] text-muted-foreground">no data yet</div>;
  }
  const max = Math.max(...data) || 1;
  const pts = data
    .map((d, i) => `${(i / (data.length - 1)) * 100},${28 - (d / max) * 24}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 30" className="h-8 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function statusPill(status: string | null) {
  if (!status) return <Badge variant="outline">no data</Badge>;
  const variant =
    status === "healthy" ? ("secondary" as const) : status === "degraded" ? ("outline" as const) : ("destructive" as const);
  return <Badge variant={variant}>{status}</Badge>;
}

export function MonitoringView({
  tenantId,
  canWrite,
  ingestUrl,
  cards,
}: {
  tenantId: string;
  canWrite: boolean;
  ingestUrl: string;
  cards: CardData[];
}) {
  const [freshKeys, setFreshKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function rotate(card: CardData) {
    if (card.keyPrefix && !confirm("Rotating revokes the current key immediately. Your reporter must be updated with the new one. Continue?")) return;
    setBusy(card.subscriptionId);
    const res = await rotateIngestKeyAction(tenantId, card.subscriptionId);
    setBusy(null);
    if (res.ok) {
      setFreshKeys((k) => ({ ...k, [card.subscriptionId]: res.key }));
      toast.success("New key minted — copy it now; it won't be shown again");
    } else toast.error(res.error);
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-heading">Monitoring</h1>
        <p className="text-sm text-muted-foreground">
          Uptime, business metrics, and the reporting integration for each product.
        </p>
      </div>

      {cards.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <Activity className="mx-auto mb-2 size-8 opacity-40" />
            No active subscriptions to monitor.
          </CardContent>
        </Card>
      )}

      {cards.map((card) => {
        const fresh = freshKeys[card.subscriptionId];
        const curl = `curl -X POST ${ingestUrl} \\
  -H "x-metrics-key: ${fresh ?? `${card.keyPrefix ?? "pwk_…"}…`}" \\
  -H "Content-Type: application/json" \\
  -d '{"events":[{"metric":"status","metadata":{"value":"healthy"}},{"metric":"response_time_ms","quantity":120}${card.sampleKeys[0] ? `,{"metric":"${card.sampleKeys[0]}","quantity":42}` : ""}]}'`;
        return (
          <Card key={card.subscriptionId}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="size-2.5 rounded-full" style={{ background: card.productColor ?? "var(--primary)" }} />
                {card.productName}
                {statusPill(card.latestStatus)}
              </CardTitle>
              {card.domainUrl && (
                <a href={card.domainUrl.includes("://") ? card.domainUrl : `https://${card.domainUrl}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                  {card.domainUrl}
                </a>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-md border p-2">
                  <div className="text-lg font-semibold tabular-nums text-heading">
                    {card.uptime.uptimePct != null ? `${card.uptime.uptimePct}%` : "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">Uptime 30d ({card.uptime.probes} probes)</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-lg font-semibold tabular-nums text-heading">
                    {card.uptime.avgResponseMs != null ? `${card.uptime.avgResponseMs}ms` : "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">Avg response</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-lg font-semibold tabular-nums text-heading">{card.kpis.length}</div>
                  <div className="text-[11px] text-muted-foreground">Tracked KPIs</div>
                </div>
              </div>

              {card.kpis.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {card.kpis.map((k) => {
                    const change =
                      k.current != null && k.previous != null && k.previous !== 0
                        ? Math.round(((k.current - k.previous) / k.previous) * 100)
                        : null;
                    return (
                      <div key={k.key} className={`rounded-md border p-3 ${k.isPrimary ? "border-primary/40" : ""}`}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs text-muted-foreground">{k.label}</span>
                          {change != null && (
                            <span className={`text-xs tabular-nums ${(change >= 0) === (k.direction !== "down_is_good") ? "text-success" : "text-warning"}`}>
                              {change >= 0 ? "+" : ""}{change}%
                            </span>
                          )}
                        </div>
                        <div className="text-xl font-semibold tabular-nums text-heading">
                          {k.current != null ? Math.round(k.current * 100) / 100 : "—"}
                          {k.unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{k.unit}</span>}
                        </div>
                        <Sparkline data={k.series} />
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="rounded-md border bg-secondary/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-heading">
                    <KeyRound className="size-4" /> Reporting integration
                  </span>
                  {canWrite && (
                    <Button variant="outline" size="sm" className="gap-1" disabled={busy === card.subscriptionId} onClick={() => rotate(card)}>
                      <RefreshCw className="size-3.5" />
                      {card.keyPrefix ? "Rotate key" : "Generate key"}
                    </Button>
                  )}
                </div>
                {fresh ? (
                  <p className="mb-2 break-all rounded bg-warning/10 p-2 font-mono text-xs text-warning">
                    {fresh}
                    <span className="ml-2 font-sans text-muted-foreground">— copy now; shown once</span>
                  </p>
                ) : (
                  <p className="mb-2 text-xs text-muted-foreground">
                    Key: <span className="font-mono">{card.keyPrefix ? `${card.keyPrefix}…` : "none yet"}</span> · send events every ~30 minutes
                  </p>
                )}
                <pre className="overflow-x-auto rounded bg-background p-2 text-[11px] leading-relaxed">{curl}</pre>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
