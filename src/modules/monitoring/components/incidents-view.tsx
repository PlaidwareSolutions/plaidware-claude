"use client";

import Link from "next/link";
import { BellOff, Siren } from "lucide-react";
import type { Incident, QuietReporter } from "../service";
import { ackIncidentAction } from "../actions";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { OPS } from "@/lib/routes";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export function IncidentsView({
  incidents,
  quiet,
}: {
  incidents: Incident[];
  quiet: QuietReporter[];
}) {
  const { run, isPending } = useAction();
  const confirm = useConfirm();

  async function ack(i: Incident) {
    const r = await confirm({
      title: `Acknowledge ${i.tenantName} · ${i.productName}?`,
      description:
        "Clears this incident from the board. The next failing check re-alerts automatically, so acknowledge only once you're on it.",
      confirmLabel: "Acknowledge",
      field: { label: "Note (optional)", placeholder: "What you found or did" },
    });
    if (!r) return;
    void run(() => ackIncidentAction(i.healthCheckId, i.subscriptionId, r.value || undefined), {
      key: i.healthCheckId,
      success: "Acknowledged — the next failing check re-alerts automatically",
    });
  }

  return (
    <>
      <Section title="Active incidents" icon={Siren} count={incidents.length}>
        {incidents.length === 0 ? (
          <EmptyState
            tone="success"
            icon={Siren}
            title="All monitored sites healthy or acknowledged"
            description="Probes run every few minutes; a failing check opens an incident here."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {incidents.map((i) => (
              <div
                key={i.healthCheckId}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-card px-4 py-3"
              >
                <StatusBadge kind="health" status={i.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-sm">
                    <Link href={OPS.client(i.tenantId)} className="font-medium text-heading hover:text-primary">
                      {i.tenantName}
                    </Link>
                    <span className="text-muted-foreground">·</span>
                    <Link href={OPS.product(i.productId)} className="hover:text-primary">
                      {i.productName}
                    </Link>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    via {i.source} · since {formatDateTime(i.since)} ({formatRelative(i.since)})
                    {i.detail && <> · {i.detail}</>}
                  </div>
                </div>
                <Button size="sm" variant="outline" disabled={isPending(i.healthCheckId)} onClick={() => ack(i)}>
                  {isPending(i.healthCheckId) ? "Saving…" : "Acknowledge…"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Quiet reporters"
        icon={BellOff}
        count={quiet.length}
        description="Live subscriptions whose reporter has not posted metrics within its product's threshold."
      >
        {quiet.length === 0 ? (
          <EmptyState tone="success" icon={BellOff} title="Every active subscription is reporting on time" />
        ) : (
          <div className="flex flex-col gap-2">
            {quiet.map((q) => (
              <div key={q.subscriptionId} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={OPS.client(q.tenantId)} className="font-medium text-heading hover:text-primary">
                    {q.tenantName}
                  </Link>
                  <span className="text-muted-foreground"> · </span>
                  <Link href={OPS.product(q.productId)} className="hover:text-primary">
                    {q.productName}
                  </Link>
                </div>
                <span className="text-xs text-muted-foreground">
                  last seen {q.lastSeen ? `${formatDateTime(q.lastSeen)} (${formatRelative(q.lastSeen)})` : "never"} · threshold{" "}
                  {q.thresholdMinutes} min
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
