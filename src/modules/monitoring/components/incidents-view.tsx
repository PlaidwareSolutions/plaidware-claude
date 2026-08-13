"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BellOff, CheckCircle2, Siren } from "lucide-react";
import type { Incident, QuietReporter } from "../service";
import { ackIncidentAction } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function IncidentsView({
  incidents,
  quiet,
}: {
  incidents: Incident[];
  quiet: QuietReporter[];
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function ack(i: Incident) {
    setBusy(i.healthCheckId);
    const res = await ackIncidentAction(i.healthCheckId, i.subscriptionId, notes[i.healthCheckId]);
    setBusy(null);
    if (res.ok) {
      toast.success("Acknowledged — the next failing check re-alerts automatically");
      router.refresh();
    } else toast.error(res.error ?? "Ack failed");
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-heading">Monitoring</h1>
        <p className="text-sm text-muted-foreground">
          Active incidents and reporters that have gone quiet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Siren className="size-4 text-destructive" /> Active incidents
            <Badge variant={incidents.length ? "destructive" : "secondary"}>{incidents.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {incidents.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="size-4" /> All monitored subscriptions healthy or acknowledged.
            </p>
          )}
          {incidents.map((i) => (
            <div key={i.healthCheckId} className="flex flex-col gap-2 rounded-md border border-destructive/30 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="destructive">{i.status}</Badge>
                <span className="font-medium text-heading">{i.productName}</span>
                <span className="text-xs text-muted-foreground">
                  via {i.source} · since {new Date(i.since).toLocaleString()}
                </span>
              </div>
              {i.detail && <p className="text-xs text-muted-foreground">{i.detail}</p>}
              <div className="flex gap-2">
                <Input
                  className="h-8 text-xs"
                  placeholder="Ack note (optional)"
                  value={notes[i.healthCheckId] ?? ""}
                  onChange={(e) => setNotes({ ...notes, [i.healthCheckId]: e.target.value })}
                />
                <Button size="sm" variant="outline" disabled={busy === i.healthCheckId} onClick={() => ack(i)}>
                  Acknowledge
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellOff className="size-4 text-warning" /> Quiet reporters
            <Badge variant={quiet.length ? "outline" : "secondary"}>{quiet.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {quiet.length === 0 && (
            <p className="text-sm text-muted-foreground">Every active subscription is reporting on time.</p>
          )}
          {quiet.map((q) => (
            <div key={q.subscriptionId} className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
              <span className="font-medium text-heading">{q.productName}</span>
              <span className="text-xs text-muted-foreground">
                last seen {q.lastSeen ? new Date(q.lastSeen).toLocaleString() : "never"} · threshold {q.thresholdMinutes} min
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
