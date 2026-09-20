import { LayoutDashboard, SquareUserRound } from "lucide-react";
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
  { href: WORK.my, label: "My work", icon: SquareUserRound, countKey: "my" },
];

/** Exactly "/work/<slug>" — the kanban board, the one wide route in the work area. */
export function isWorkBoardPath(pathname: string): boolean {
  if (!pathname.startsWith(WORK.home + "/")) return false;
  const rest = pathname.slice(WORK.home.length + 1);
  return rest.length > 0 && !rest.includes("/") && pathname !== WORK.my;
}
