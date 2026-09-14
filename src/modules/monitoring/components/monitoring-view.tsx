"use client";

import type { MonitoringCardData } from "../queries";
import { MonitoringCards } from "./monitoring-cards";

/** Client-facing Monitoring page body (the PageHeader restyle lands in Phase 3). */
export function MonitoringView({
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
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-heading">Monitoring</h1>
        <p className="text-sm text-muted-foreground">
          Uptime, business metrics, and the reporting integration for each product.
        </p>
      </div>
      <MonitoringCards tenantId={tenantId} canWrite={canWrite} ingestUrl={ingestUrl} cards={cards} />
    </div>
  );
}
