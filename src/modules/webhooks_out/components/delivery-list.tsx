"use client";

import { RotateCcw, Webhook } from "lucide-react";
import type { WebhookDeliveryDto } from "../queries";
import { requeueDeliveryAction } from "../actions";
import { formatDateTime } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** MHub lifecycle + handshake deliveries for one client, with requeue on dead letters. */
export function DeliveryList({ deliveries, dead }: { deliveries: WebhookDeliveryDto[]; dead: number }) {
  const { run, isPending } = useAction();
  return (
    <Section
      title="MHub deliveries"
      icon={Webhook}
      count={deliveries.length}
      description={dead ? `${dead} dead-lettered — requeue restarts the backoff with the same delivery id` : undefined}
    >
      {deliveries.length === 0 ? (
        <EmptyState icon={Webhook} title="No MHub deliveries" description="Only clients with a marketing-* subscription exchange lifecycle events with MHub." />
      ) : (
        <div className="flex flex-col gap-2">
          {deliveries.map((d) => (
            <div key={d.id} className="flex flex-col gap-1 rounded-lg border bg-card px-4 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge kind="webhook" status={d.status} />
                <span className="font-medium text-heading">{d.event}</span>
                {d.kind === "provision" && <Badge variant="outline">handshake</Badge>}
                {d.productName && <span className="text-xs text-muted-foreground">{d.productName}</span>}
                <span className="text-xs text-muted-foreground">attempt {d.attemptCount} · {formatDateTime(d.createdAt)}</span>
                {(d.status === "dead" || d.status === "disabled") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto gap-1"
                    disabled={isPending(d.id)}
                    onClick={() => void run(() => requeueDeliveryAction(d.id), { key: d.id, success: "Requeued — the worker retries within a minute" })}
                  >
                    <RotateCcw className="size-3" /> {isPending(d.id) ? "Requeuing…" : "Requeue"}
                  </Button>
                )}
              </div>
              {d.lastError && <p className="text-xs text-destructive">{d.lastError}</p>}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
