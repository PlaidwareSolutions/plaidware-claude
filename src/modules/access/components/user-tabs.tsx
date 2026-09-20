"use client";

import { LinkTabs } from "@/components/link-tabs";
import { OPS } from "@/lib/routes";

export function UserTabs({ id, counts }: { id: string; counts: { workspaces: number; sessions: number } }) {
  return (
    <LinkTabs
      items={[
        { href: OPS.user(id), label: "Overview", exact: true },
        { href: OPS.userTab(id, "workspaces"), label: "Workspaces", count: counts.workspaces },
        { href: OPS.userTab(id, "sessions"), label: "Sessions", count: counts.sessions },
        { href: OPS.userTab(id, "activity"), label: "Activity" },
      ]}
    />
  );
}
