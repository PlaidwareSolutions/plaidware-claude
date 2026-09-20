"use client";

import { startTransition, useMemo, useOptimistic, useState } from "react";
import { DndContext, DragOverlay, closestCorners, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { useAction } from "@/lib/use-action";
import { moveItemAction } from "../../actions";
import type { WorkItemStatus } from "../../contracts";
import type { WorkColumnDto } from "../../dto";
import { BoardColumn } from "./board-column";
import { ItemCardBody } from "./item-card";
import { dropTarget, findCard, reduceMove, type ColumnMap } from "./move-math";
import { SCREEN_READER_INSTRUCTIONS, boardAnnouncements, pointerBelow, useBoardSensors, useReducedMotion } from "./use-board-dnd";

/**
 * The kanban board. A drop applies optimistically (useOptimistic reducer)
 * inside the same transition that runs the server action; the action's own
 * refresh() delivers the fresh tree in that transition, so a card never
 * flashes back, and a failed action simply reverts it (plus a toast).
 */
export function KanbanBoard({ slug, columns, doneCaption }: { slug: string; columns: WorkColumnDto[]; doneCaption: string }) {
  const initial = useMemo<ColumnMap>(() => Object.fromEntries(columns.map((c) => [c.status, c.cards])), [columns]);
  const [cols, applyMove] = useOptimistic(initial, reduceMove);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { run } = useAction();
  const sensors = useBoardSensors();
  const reducedMotion = useReducedMotion();

  const labelOf = (status: string) => columns.find((c) => c.status === status)?.label ?? status;
  const describe = (id: string) => {
    const f = findCard(cols, id);
    return f ? `${f.card.key} ${f.card.title}` : "the card";
  };
  const columnOf = (id: string) => (id.startsWith("col:") ? labelOf(id.slice(4)) : labelOf(findCard(cols, id)?.status ?? ""));

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    const overColumn = over.data.current?.type === "column" ? (over.data.current.status as WorkItemStatus) : null;
    const t = dropTarget({ activeId: String(active.id), overId, overColumn, cols, below: pointerBelow(e) });
    if (!t) return;
    const itemId = String(active.id);
    startTransition(async () => {
      applyMove({ itemId, to: t.to, index: t.index });
      await run(() => moveItemAction({ itemId, status: t.to, prevId: t.prevId ?? null, nextId: t.nextId ?? null }), {
        key: `move:${itemId}`,
        refresh: false,
        error: "Couldn't move the item",
      });
    });
  }

  const active = activeId ? findCard(cols, activeId)?.card : null;

  return (
    <DndContext
      id="board-dnd"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{ announcements: boardAnnouncements(describe, columnOf), screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
    >
      <div className="flex snap-x gap-4 overflow-x-auto pb-4 transition-opacity group-has-data-pending:opacity-50 lg:snap-none">
        {columns.map((c) => (
          <BoardColumn
            key={c.status}
            status={c.status}
            label={c.label}
            caption={c.status === "done" ? doneCaption : undefined}
            wipLimit={c.wipLimit}
            cards={cols[c.status] ?? []}
            slug={slug}
            reducedMotion={reducedMotion}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={reducedMotion ? null : undefined}>{active ? <ItemCardBody card={active} slug={slug} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}
