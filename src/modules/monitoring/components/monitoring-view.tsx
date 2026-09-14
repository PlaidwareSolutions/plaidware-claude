"use client";

import type { MonitoringCardData } from "../queries";
import { PageHeader } from "@/components/page-header";
import { MonitoringCards } from "./monitoring-cards";

/** Client-facing Monitoring page body. */
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
      <PageHeader title="Monitoring" description="Uptime, business metrics, and the reporting integration for each product." />
      <MonitoringCards tenantId={tenantId} canWrite={canWrite} ingestUrl={ingestUrl} cards={cards} />
    </div>
  );
}
