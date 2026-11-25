"use client";

import { useMemo, useSyncExternalStore } from "react";
import { ChevronRight, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import type { WorkExplorerProduct, WorkUserRef } from "../../dto";
import { explorerColumns, groupLanes, type ExplorerCard, type ExplorerFilters, type Lane } from "../../explorer-logic";
import { STATUS_LABELS } from "../../transitions";
import { BoardPeopleProvider } from "../board/item-card";
import { ColumnCount } from "../board/board-column";
import { KanbanBoard } from "../board/kanban-board";
import { InlineCreate } from "./inline-create";

const COLLAPSED_KEY = "work.explorer.collapsed";
const COLLAPSED_EVENT = "work-explorer-collapsed";

/** Collapsed swimlanes, remembered per browser (a convenience: private mode just forgets). */
const collapsedStore = {
  subscribe(cb: () => void) {
    window.addEventListener("storage", cb);
    window.addEventListener(COLLAPSED_EVENT, cb);
    return () => {
      window.removeEventListener("storage", cb);
      window.removeEventListener(COLLAPSED_EVENT, cb);
    };
  },
  get(): string {
    try {
      return localStorage.getItem(COLLAPSED_KEY) ?? "[]";
    } catch {
      return "[]";
    }
  },
  set(keys: string[]) {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(keys));
    } catch {
      /* not remembered */
    }
    window.dispatchEvent(new Event(COLLAPSED_EVENT));
  },
};

function parseKeys(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The cross-product kanban: one header row, then one board per swimlane.
 * Drag between columns changes status (each lane is its own drag context —
 * moving a card to another lane is a field edit in the quick view).
 */
export function ExplorerBoard({
  cards,
  filters,
  products,
  assignees,
  viewerId,
  canLinkClient,
  doneWindowDays,
  doneCaption,
  showBacklog = true,
}: {
  cards: ExplorerCard[];
  filters: ExplorerFilters;
  products: WorkExplorerProduct[];
  /** Who a card's avatar can be reassigned to. */
  assignees: WorkUserRef[];
  viewerId: string;
  canLinkClient: boolean;
  doneWindowDays: number;
  /** Overrides "last N days" on the Done header (a sprints board: "this sprint"). */
  doneCaption?: string;
  /** A sprints board leaves the backlog to its Backlog tab. */
  showBacklog?: boolean;
}) {
  const statuses = explorerColumns(filters, { backlog: showBacklog });
  const lanes = useMemo(
    () => groupLanes(cards, filters.group, { viewerId, productOrder: products.map((p) => p.slug) }),
    [cards, filters.group, viewerId, products],
  );
  const raw = useSyncExternalStore(collapsedStore.subscribe, collapsedStore.get, () => "[]");
  const collapsed = useMemo(() => parseKeys(raw), [raw]);
  const toggle = (key: string) => collapsedStore.set(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key]);

  const defaultProduct = filters.product.length === 1 ? filters.product[0] : undefined;
  const count = (status: string) => cards.filter((c) => c.status === status).length;
  const grouped = filters.group !== "none";

  return (
    <BoardPeopleProvider assignees={assignees} viewerId={viewerId}>
    <div className="flex flex-col transition-opacity group-has-data-pending:opacity-50">
      <div className={cn("sticky top-0 z-10 hidden gap-2 bg-background pb-1", grouped && "lg:flex")}>
        {statuses.map((s) => (
          <div
            key={s}
            className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-md bg-board-column px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            <h3>{STATUS_LABELS[s]}</h3>
            <ColumnCount count={count(s)} />
            {s === "done" && <ListChecks className="size-4 text-success" aria-hidden />}
            {s === "done" && <span className="ml-auto text-[11px] font-normal normal-case tracking-normal">{doneCaption ?? `last ${doneWindowDays} days`}</span>}
          </div>
        ))}
      </div>

      {lanes.length === 0 || (lanes.length === 1 && lanes[0].cards.length === 0 && !grouped) ? (
        <EmptyLane statuses={statuses} lane={{ key: "all", label: "All", cards: [], defaults: {} }} {...{ products, defaultProduct, canLinkClient }} />
      ) : (
        lanes.map((lane) => {
          const isCollapsed = collapsed.includes(`${filters.group}:${lane.key}`);
          return (
            <section key={lane.key} className={cn(grouped && "border-t pt-1")} aria-label={grouped ? lane.label : undefined}>
              {grouped && (
                <button
                  type="button"
                  onClick={() => toggle(`${filters.group}:${lane.key}`)}
                  aria-expanded={!isCollapsed}
                  className="my-1 flex w-full items-center gap-2 rounded-[3px] px-1 py-1.5 text-left text-sm hover:bg-accent/60"
                >
                  <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", !isCollapsed && "rotate-90")} />
                  <LaneBadge lane={lane} group={filters.group} />
                  <span className="font-semibold text-foreground">{lane.label}</span>
                  <span className="text-sm text-muted-foreground">
                    ({lane.cards.length} item{lane.cards.length === 1 ? "" : "s"})
                  </span>
                  <LaneProgress cards={lane.cards} />
                </button>
              )}
              {!isCollapsed && (
                <KanbanBoard
                  slug=""
                  dndId={`explorer-${lane.key}`}
                  linkMode="peek"
                  hideHeaders={grouped}
                  doneCaption={grouped ? undefined : (doneCaption ?? `last ${doneWindowDays} days`)}
                  tall={!grouped}
                  columns={statuses.map((s) => ({ status: s, label: STATUS_LABELS[s], wipLimit: null, cards: lane.cards.filter((c) => c.status === s) }))}
                  renderFooter={(status) => (
                    <InlineCreate status={status} lane={lane.defaults} products={products} defaultProduct={defaultProduct} canLinkClient={canLinkClient} />
                  )}
                />
              )}
            </section>
          );
        })
      )}
    </div>
    </BoardPeopleProvider>
  );
}

function EmptyLane({
  statuses,
  lane,
  products,
  defaultProduct,
  canLinkClient,
}: {
  statuses: ReturnType<typeof explorerColumns>;
  lane: Lane;
  products: WorkExplorerProduct[];
  defaultProduct: string | undefined;
  canLinkClient: boolean;
}) {
  return (
    <KanbanBoard
      slug=""
      dndId="explorer-empty"
      linkMode="peek"
      tall
      columns={statuses.map((s) => ({ status: s, label: STATUS_LABELS[s], wipLimit: null, cards: [] }))}
      renderFooter={(status) => <InlineCreate status={status} lane={lane.defaults} products={products} defaultProduct={defaultProduct} canLinkClient={canLinkClient} />}
    />
  );
}

function LaneBadge({ lane, group }: { lane: Lane; group: ExplorerFilters["group"] }) {
  if (group === "product") return <span className="size-3 rounded-full" style={{ background: lane.color ?? "var(--primary)" }} />;
  if (group === "assignee" && lane.defaults.assigneeUserId) return <UserAvatar name={lane.label} size="sm" />;
  return null;
}

/** "3 of 8 done" bar on a lane header. */
function LaneProgress({ cards }: { cards: ExplorerCard[] }) {
  const done = cards.filter((c) => c.status === "done").length;
  if (cards.length === 0) return null;
  const pct = Math.round((done / cards.length) * 100);
  return (
    <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground" title={`${done} of ${cards.length} done`}>
      <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-accent sm:block">
        <span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
      </span>
      {pct}%
    </span>
  );
}
