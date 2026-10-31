"use client";

import { startTransition, useMemo, useOptimistic, useState } from "react";
import { DndContext, DragOverlay, closestCorners, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { moveItemAction } from "../../actions";
import type { WorkItemStatus } from "../../contracts";
import type { WorkColumnDto } from "../../dto";
import { canTransition, transitionNeedsScreen } from "../../transitions";
import { useWorkTransitions } from "../transition-host";
import { BoardColumn, type DropState } from "./board-column";
import { ItemCardBody, type CardLinkMode } from "./item-card";
import { dropTarget, findCard, reduceMove, type ColumnMap } from "./move-math";
import { SCREEN_READER_INSTRUCTIONS, boardAnnouncements, markDragEnd, pointerBelow, useBoardSensors, useReducedMotion } from "./use-board-dnd";

/**
 * The kanban board, with Jira's workflow on drag: while a card is held, each
 * column shows whether it can take it (blue "Drop here" vs ⊘ "Not allowed");
 * a drop on a blocked column snaps back with the reason; a drop on Done opens
 * the Resolve screen first (cancel = the card stays put). An allowed drop
 * applies optimistically (useOptimistic) inside the transition that runs the
 * server action, whose refresh() lands the fresh tree in the same pass.
 */
export function KanbanBoard({
  slug,
  columns,
  doneCaption,
  dndId = "board-dnd",
  linkMode,
  hideHeaders,
  renderFooter,
  tall,
}: {
  slug: string;
  columns: WorkColumnDto[];
  doneCaption?: string;
  /** Unique per board on the page (swimlanes each get one). */
  dndId?: string;
  linkMode?: CardLinkMode;
  /** Swimlanes share one header row above them. */
  hideHeaders?: boolean;
  renderFooter?: (status: WorkItemStatus) => React.ReactNode;
  /** Columns reach down the screen (Jira's single board); swimlanes stay compact. */
  tall?: boolean;
}) {
  const initial = useMemo<ColumnMap>(() => Object.fromEntries(columns.map((c) => [c.status, c.cards])), [columns]);
  const [cols, applyMove] = useOptimistic(initial, reduceMove);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<WorkItemStatus | null>(null);
  const { run } = useAction();
  const transitions = useWorkTransitions();
  const sensors = useBoardSensors();
  const reducedMotion = useReducedMotion();

  const labelOf = (status: string) => columns.find((c) => c.status === status)?.label ?? status;
  const describe = (id: string) => {
    const f = findCard(cols, id);
    return f ? `${f.card.key} ${f.card.title}` : "the card";
  };
  const columnOf = (id: string) => (id.startsWith("col:") ? labelOf(id.slice(4)) : labelOf(findCard(cols, id)?.status ?? ""));
  const statusUnder = (over: DragOverEvent["over"]): WorkItemStatus | null =>
    over ? ((over.data.current?.status as WorkItemStatus | undefined) ?? (findCard(cols, String(over.id))?.status as WorkItemStatus | undefined) ?? null) : null;

  const active = activeId ? findCard(cols, activeId)?.card : null;
  const dropState = (status: WorkItemStatus): DropState | undefined =>
    !active ? undefined : status === active.status ? "origin" : canTransition(active.status, status) ? "allowed" : "blocked";

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setOverStatus(null);
  }

  function end() {
    setActiveId(null);
    setOverStatus(null);
    markDragEnd();
  }

  async function onDragEnd(e: DragEndEvent) {
    end();
    const { active: a, over } = e;
    if (!over) return;
    const card = findCard(cols, String(a.id))?.card;
    const overColumn = over.data.current?.type === "column" ? (over.data.current.status as WorkItemStatus) : null;
    const t = dropTarget({ activeId: String(a.id), overId: String(over.id), overColumn, cols, below: pointerBelow(e) });
    if (!t || !card) return;
    let details = {};
    // Plain allowed moves stay synchronous (no flash back); only a blocked move or a screen awaits.
    if (t.to !== card.status && (!canTransition(card.status, t.to) || transitionNeedsScreen(t.to))) {
      const asked = await transitions.ask({ id: card.id, key: card.key, type: card.type, status: card.status, title: card.title }, t.to);
      if (!asked || asked === "blocked") return; // snapped back; ask() toasted the reason
      details = asked;
    }
    const itemId = card.id;
    startTransition(async () => {
      applyMove({ itemId, to: t.to, index: t.index });
      await run(() => moveItemAction({ itemId, status: t.to, prevId: t.prevId ?? null, nextId: t.nextId ?? null, ...details }), {
        key: `move:${itemId}`,
        refresh: false,
        error: "Couldn't move the item",
      });
    });
  }

  const overlayBlocked = !!active && !!overStatus && overStatus !== active.status && !canTransition(active.status, overStatus);

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={(e) => setOverStatus(statusUnder(e.over))}
      onDragEnd={(e) => void onDragEnd(e)}
      onDragCancel={end}
      accessibility={{ announcements: boardAnnouncements(describe, columnOf), screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
    >
      <div className={cn(cnBoard(!!active), tall && "min-h-[calc(100vh-17rem)]")}>
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
            linkMode={linkMode}
            hideHeader={hideHeaders}
            footer={active ? undefined : renderFooter?.(c.status)}
            dropState={dropState(c.status)}
            hovered={overStatus === c.status}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
        {active ? <ItemCardBody card={active} slug={slug} linkMode={linkMode} dragging blocked={overlayBlocked} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

const cnBoard = (dragging: boolean) =>
  `flex snap-x gap-2 overflow-x-auto pb-2 transition-opacity group-has-data-pending:opacity-50 lg:snap-none${dragging ? " cursor-grabbing" : ""}`;
