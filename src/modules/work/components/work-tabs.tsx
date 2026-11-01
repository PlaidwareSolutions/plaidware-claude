"use client";

import { CalendarRange, Columns3, List, ListTodo, Settings } from "lucide-react";
import { LinkTabs } from "@/components/link-tabs";
import { WORK, withQuery } from "@/lib/routes";
import type { WorkBoardMode } from "../contracts";

/** A company board's tabs, Jira-style (icon + label): Board · List · Settings — plus Backlog and Sprints on a sprints board. */
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
      tone="info"
      items={[
        { href: WORK.board(slug), label: mode === "sprints" ? "Active sprint" : "Board", icon: Columns3, exact: true, query: { view: undefined } },
        // Kanban boards keep the backlog as a board column; a sprints board plans its sprints from the Backlog page.
        ...(mode === "sprints"
          ? [
              { href: WORK.backlog(slug), label: "Backlog", icon: ListTodo, count: counts.backlog },
              { href: WORK.sprints(slug), label: "Sprints", icon: CalendarRange, count: counts.sprints },
            ]
          : []),
        { href: withQuery(WORK.board(slug), { view: "list" }), label: "List", icon: List, exact: true, query: { view: "list" } },
        ...(canManage ? [{ href: WORK.settings(slug), label: "Settings", icon: Settings }] : []),
      ]}
    />
  );
}

/** The cross-company board's tabs: Board · List. */
export function AllWorkTabs() {
  return (
    <LinkTabs
      tone="info"
      items={[
        { href: WORK.all, label: "Board", icon: Columns3, exact: true, query: { view: undefined } },
        { href: withQuery(WORK.all, { view: "list" }), label: "List", icon: List, exact: true, query: { view: "list" } },
      ]}
    />
  );
}
