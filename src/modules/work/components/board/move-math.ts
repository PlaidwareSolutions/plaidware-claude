import type { WorkItemStatus } from "../../contracts";
import type { WorkCardDto } from "../../dto";

/** Pure drop arithmetic for the kanban board and the backlog list. */

export type ColumnMap = Record<string, WorkCardDto[]>;
export type MoveAction = { itemId: string; to: WorkItemStatus; index: number };

export function findCard(cols: ColumnMap, id: string): { status: string; index: number; card: WorkCardDto } | null {
  for (const [status, cards] of Object.entries(cols)) {
    const index = cards.findIndex((c) => c.id === id);
    if (index >= 0) return { status, index, card: cards[index] };
  }
  return null;
}

/** The optimistic reducer: lift the card out of wherever it is and drop it at `index` in `to`. */
export function reduceMove(cols: ColumnMap, a: MoveAction): ColumnMap {
  const from = findCard(cols, a.itemId);
  if (!from) return cols;
  const next: ColumnMap = { ...cols, [from.status]: cols[from.status].filter((c) => c.id !== a.itemId) };
  const target = [...(next[a.to] ?? [])];
  target.splice(Math.min(a.index, target.length), 0, { ...from.card, status: a.to });
  return { ...next, [a.to]: target };
}

/** Neighbours around `index` in a target list that no longer contains the moving card. */
export function neighboursFor(target: WorkCardDto[], index: number): { prevId?: string; nextId?: string } {
  return { prevId: target[index - 1]?.id, nextId: target[index]?.id };
}

export type DropResolution = { to: WorkItemStatus; index: number; prevId?: string; nextId?: string };

/**
 * Where a drag ends up. `over` is either a column (`overColumn` set) or a
 * card; `below` says the pointer is past the over-card's midpoint. Returns
 * null for a no-op (same column, same position).
 */
export function dropTarget(o: {
  activeId: string;
  overId: string;
  overColumn: WorkItemStatus | null;
  cols: ColumnMap;
  below: boolean;
}): DropResolution | null {
  const from = findCard(o.cols, o.activeId);
  if (!from) return null;
  let to: WorkItemStatus;
  let index: number;
  if (o.overColumn) {
    to = o.overColumn;
    index = (o.cols[to] ?? []).filter((c) => c.id !== o.activeId).length;
  } else {
    const over = findCard(o.cols, o.overId);
    if (!over || over.card.id === o.activeId) return null;
    to = over.status as WorkItemStatus;
    const without = o.cols[to].filter((c) => c.id !== o.activeId);
    const overIndex = without.findIndex((c) => c.id === o.overId);
    index = o.below ? overIndex + 1 : overIndex;
  }
  if (to === from.status && index === from.index) return null;
  const target = (o.cols[to] ?? []).filter((c) => c.id !== o.activeId);
  return { to, index, ...neighboursFor(target, index) };
}
