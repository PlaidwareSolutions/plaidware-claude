"use client";

import { LinkTabs } from "@/components/link-tabs";
import { OPS } from "@/lib/routes";

export function ClientTabs({ id }: { id: string }) {
  return (
    <LinkTabs
      items={[
        { href: OPS.client(id), label: "Overview", exact: true },
        { href: OPS.clientTab(id, "billing"), label: "Subscriptions & billing" },
        { href: OPS.clientTab(id, "provisioning"), label: "Provisioning" },
        { href: OPS.clientTab(id, "monitoring"), label: "Monitoring" },
        { href: OPS.clientTab(id, "people"), label: "People" },
        { href: OPS.clientTab(id, "activity"), label: "Activity" },
      ]}
    />
  );
}
