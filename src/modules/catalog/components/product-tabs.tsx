"use client";

import { LinkTabs } from "@/components/link-tabs";
import { OPS } from "@/lib/routes";

export function ProductTabs({
  id,
  counts,
  isMarketing,
}: {
  id: string;
  counts: { components: number; kpis: number; subscribers: number };
  isMarketing: boolean;
}) {
  return (
    <LinkTabs
      items={[
        { href: OPS.product(id), label: "Details", exact: true },
        { href: OPS.productTab(id, "pricing"), label: "Pricing components", count: counts.components },
        { href: OPS.productTab(id, "kpis"), label: "Monitoring KPIs", count: counts.kpis },
        ...(isMarketing ? [] : [{ href: OPS.productTab(id, "defaults"), label: "Provisioning defaults" }]),
        { href: OPS.productTab(id, "subscribers"), label: "Subscribers", count: counts.subscribers },
      ]}
    />
  );
}
