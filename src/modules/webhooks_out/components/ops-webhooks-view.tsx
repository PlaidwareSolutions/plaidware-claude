"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, RotateCcw, Webhook } from "lucide-react";
import type { WebhookDeliveryDto } from "../queries";
import { requeueDeliveryAction } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_VARIANT: Record<WebhookDeliveryDto["status"], "secondary" | "outline" | "destructive"> =
  {
    pending: "outline",
    delivered: "secondary",
    dead: "destructive",
    disabled: "destructive",
  };

function DeliveryRow({ d, requeueable }: { d: WebhookDeliveryDto; requeueable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function requeue() {
    setBusy(true);
    const res = await requeueDeliveryAction(d.id);
    setBusy(false);
    if (res.ok) {
      toast.success("Requeued — the worker retries within a minute");
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <div className="flex flex-col gap-1 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[d.status]}>{d.status}</Badge>
        <span className="font-medium text-heading">{d.event}</span>
        {d.kind === "provision" && <Badge variant="outline">handshake</Badge>}
        <span className="text-xs text-muted-foreground">
          attempt {d.attemptCount} · {new Date(d.createdAt).toLocaleString()}
        </span>
        {requeueable && (
          <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={requeue}>
            <RotateCcw className="size-3" /> Requeue
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
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        MHub lifecycle deliveries and provisioning handshakes. Dead letters exhausted their
        retries; requeue restarts the backoff with the same delivery id.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="size-4 text-destructive" /> Dead letters
            <Badge variant={dead.length ? "destructive" : "secondary"}>{dead.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {dead.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="size-4" /> Nothing dead-lettered or disabled.
            </p>
          )}
          {dead.map((d) => (
            <DeliveryRow key={d.id} d={d} requeueable />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="size-4" /> Recent deliveries
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {recent.length === 0 && (
            <p className="text-sm text-muted-foreground">No deliveries queued yet.</p>
          )}
          {recent.map((d) => (
            <DeliveryRow key={d.id} d={d} requeueable={false} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
