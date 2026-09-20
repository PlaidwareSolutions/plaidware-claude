"use client";

import { LinkTabs } from "@/components/link-tabs";
import { WORK } from "@/lib/routes";
import type { WorkBoardMode } from "../contracts";

export function WorkTabs({
  slug,
  mode,
  canManage,
  counts,
}: {
  slug: string;
  mode: WorkBoardMode;
  canManage: boolean;
  counts: { backlog: number; sprints: number };
}) {
  return (
    <LinkTabs
      items={[
        { href: WORK.board(slug), label: "Board", exact: true },
        { href: WORK.backlog(slug), label: "Backlog", count: counts.backlog },
        ...(mode === "sprints" ? [{ href: WORK.sprints(slug), label: "Sprints", count: counts.sprints }] : []),
        ...(canManage ? [{ href: WORK.settings(slug), label: "Settings" }] : []),
      ]}
    />
  );
}
