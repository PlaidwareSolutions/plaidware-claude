"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Activity, KeyRound, RefreshCw } from "lucide-react";
import { rotateIngestKeyAction } from "../actions";
import type { MonitoringCardData } from "../queries";
import { useConfirm } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkline } from "@/components/sparkline";

/**
 * Uptime, KPIs, and the reporting integration per monitored subscription —
 * the same cards on the client's Monitoring page and the ops client tab.
 */
export function MonitoringCards({
  tenantId,
  canWrite,
  ingestUrl,
  cards,
}: {
  tenantId: string;
  canWrite: boolean;
  ingestUrl: string;
  cards: MonitoringCardData[];
}) {
  const confirm = useConfirm();
  const [freshKeys, setFreshKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function rotate(card: MonitoringCardData) {
    if (card.keyPrefix) {
      const ok = await confirm({
        title: "Rotate the ingest key?",
        description: "The current key stops working immediately. Update the reporter with the new one before its next run.",
        confirmLabel: "Rotate key",
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(card.subscriptionId);
    const res = await rotateIngestKeyAction(tenantId, card.subscriptionId);
    setBusy(null);
    if (res.ok) {
      setFreshKeys((k) => ({ ...k, [card.subscriptionId]: res.key }));
      toast.success("New key minted — copy it now; it won't be shown again");
    } else toast.error(res.error);
  }

  if (cards.length === 0) {
    return <EmptyState icon={Activity} title="No active subscriptions to monitor" />;
  }

  return (
    <div className="flex flex-col gap-4">
      {cards.map((card) => {
        const fresh = freshKeys[card.subscriptionId];
        const curl = `curl -X POST ${ingestUrl} \\
  -H "x-metrics-key: ${fresh ?? `${card.keyPrefix ?? "pwk_…"}…`}" \\
  -H "Content-Type: application/json" \\
  -d '{"events":[{"metric":"status","metadata":{"value":"healthy"}},{"metric":"response_time_ms","quantity":120}${card.sampleKeys[0] ? `,{"metric":"${card.sampleKeys[0]}","quantity":42}` : ""}]}'`;
        return (
          <Card key={card.subscriptionId} className="gap-4 py-5">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="size-2.5 rounded-full" style={{ background: card.productColor ?? "var(--primary)" }} />
                {card.productName}
                <StatusBadge kind="health" status={card.latestStatus} />
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
