import { Building2, Kanban, LayoutDashboard, SquareUserRound } from "lucide-react";
import { WORK } from "@/lib/routes";
import type { NavItem } from "@/components/ops-nav";

/** Count pills in the work sidebar. */
export type WorkNavCounts = {
  /** Open items assigned to the signed-in user. */
  my: number;
};

export type WorkBoardNav = { slug: string; name: string; keyPrefix: string; color: string | null };

/** Work-area navigation; the product boards render as a sub-list under it. */
export const WORK_NAV: NavItem[] = [
  { href: WORK.home, label: "Overview", icon: LayoutDashboard, exact: true },
  { href: WORK.all, label: "All work", icon: Kanban },
  { href: WORK.my, label: "My work", icon: SquareUserRound, countKey: "my" },
  // Ops have the full client pages; a developer's clients are the workspaces ops added them to.
  { href: WORK.clients, label: "Clients", icon: Building2, developerOnly: true },
];

/** Exactly "/work/<slug>" — a product's kanban board (and /work/all, the cross-product one): the wide routes. */
export function isWorkBoardPath(pathname: string): boolean {
  if (!pathname.startsWith(WORK.home + "/")) return false;
  const rest = pathname.slice(WORK.home.length + 1);
  return rest.length > 0 && !rest.includes("/") && pathname !== WORK.my && pathname !== WORK.clients;
}
