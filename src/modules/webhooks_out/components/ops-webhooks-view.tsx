"use client";

import Link from "next/link";
import { RotateCcw, Webhook } from "lucide-react";
import type { WebhookDeliveryDto } from "../queries";
import { requeueDeliveryAction } from "../actions";
import { formatDateTime } from "@/lib/dates";
import { OPS } from "@/lib/routes";
import { useAction } from "@/lib/use-action";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function DeliveryRow({
  d,
  requeueable,
  pending,
  onRequeue,
}: {
  d: WebhookDeliveryDto;
  requeueable: boolean;
  pending: boolean;
  onRequeue: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="webhook" status={d.status} />
        <span className="font-medium text-heading">{d.event}</span>
        {d.kind === "provision" && <Badge variant="outline">handshake</Badge>}
        {d.tenantId && (
          <span className="text-xs text-muted-foreground">
            <Link href={OPS.client(d.tenantId)} className="font-medium text-heading hover:text-primary">
              {d.tenantName ?? "client"}
            </Link>
            {d.productId && (
              <>
                {" · "}
                <Link href={OPS.product(d.productId)} className="hover:text-primary">{d.productName}</Link>
              </>
            )}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          attempt {d.attemptCount} · {formatDateTime(d.createdAt)}
        </span>
        {requeueable && (
          <Button size="sm" variant="outline" className="ml-auto gap-1" disabled={pending} onClick={onRequeue}>
            <RotateCcw className="size-3" /> {pending ? "Requeuing…" : "Requeue"}
          </Button>
        )}
      </div>
      <p className="break-all text-xs text-muted-foreground">
        {d.target || "target unconfigured"} · delivery {d.deliveryId}
      </p>
      {d.lastError && <p className="text-xs text-destructive">{d.lastError}</p>}
    </div>
  );
}

export function OpsWebhooksView({
  dead,
  recent,
}: {
  dead: WebhookDeliveryDto[];
  recent: WebhookDeliveryDto[];
}) {
  const { run, isPending } = useAction();
  const requeue = (d: WebhookDeliveryDto) =>
    void run(() => requeueDeliveryAction(d.id), {
      key: d.id,
      success: "Requeued — the worker retries within a minute",
    });

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        MHub lifecycle deliveries and provisioning handshakes. Dead letters exhausted their
        retries; requeue restarts the backoff with the same delivery id.
      </p>

      <Section title="Dead letters" icon={Webhook} count={dead.length}>
        {dead.length === 0 ? (
          <EmptyState tone="success" icon={Webhook} title="Nothing dead-lettered or disabled" />
        ) : (
          <div className="flex flex-col gap-2">
            {dead.map((d) => (
              <DeliveryRow key={d.id} d={d} requeueable pending={isPending(d.id)} onRequeue={() => requeue(d)} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Recent deliveries" icon={Webhook} count={recent.length}>
        {recent.length === 0 ? (
          <EmptyState icon={Webhook} title="No deliveries queued yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {recent.map((d) => (
              <DeliveryRow key={d.id} d={d} requeueable={false} pending={false} onRequeue={() => {}} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
