"use client";

import { startTransition, useMemo, useOptimistic, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, CalendarRange, GripVertical, Inbox } from "lucide-react";
import { DndContext, DragOverlay, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { WORK } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { useAction } from "@/lib/use-action";
import { Section } from "@/components/section";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { assignItemAction, createItemAction, moveItemAction, setItemSprintAction, updateItemAction } from "../../actions";
import type { WorkBoardMode } from "../../contracts";
import type { WorkBacklogViewDto, WorkCardDto, WorkSprintDto, WorkUserRef } from "../../dto";
import { TypeIcon } from "../item-bits";
import { pointsLabel } from "../labels";
import { AssigneeSelect, PrioritySelect, RefSelect, TypeSelect } from "../pickers";
import { SprintProgress, sprintTiming } from "../sprint-progress";
import { dropTarget, reduceMove, type ColumnMap } from "../board/move-math";
import { SCREEN_READER_INSTRUCTIONS, boardAnnouncements, pointerBelow, useBoardSensors, useReducedMotion } from "../board/use-board-dnd";

type SprintPick = Pick<WorkSprintDto, "id" | "name" | "status">;

/**
 * The prioritised backlog: drag to reorder, quick-edit type / priority /
 * assignee inline, select rows to plan them into a sprint. Planned sprints
 * and unscheduled board items are listed above it (not sortable).
 */
export function BacklogList({
  slug,
  boardId,
  mode,
  view,
  sprints,
}: {
  slug: string;
  boardId: string;
  mode: WorkBoardMode;
  view: WorkBacklogViewDto;
  /** Planned + active sprints, for "Add to sprint". */
  sprints: SprintPick[];
}) {
  const { run, isPending, pending } = useAction();
  const initial = useMemo<ColumnMap>(() => ({ backlog: view.backlog }), [view.backlog]);
  const [cols, applyMove] = useOptimistic(initial, reduceMove);
  const [pendingTitles, addPending] = useOptimistic<string[], string>([], (list, t) => [...list, t]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [targetSprint, setTargetSprint] = useState<string | null>(sprints.find((s) => s.status === "active")?.id ?? sprints[0]?.id ?? null);
  const formRef = useRef<HTMLFormElement>(null);
  const sensors = useBoardSensors();
  const reducedMotion = useReducedMotion();
  const backlog = cols.backlog ?? [];

  function toggle(id: string, on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    if (!e.over) return;
    const t = dropTarget({ activeId: String(e.active.id), overId: String(e.over.id), overColumn: null, cols, below: pointerBelow(e) });
    if (!t) return;
    const itemId = String(e.active.id);
    startTransition(async () => {
      applyMove({ itemId, to: "backlog", index: t.index });
      await run(() => moveItemAction({ itemId, status: "backlog", prevId: t.prevId ?? null, nextId: t.nextId ?? null }), {
        key: `move:${itemId}`,
        refresh: false,
        error: "Couldn't reorder",
      });
    });
  }

  async function bulk(action: (id: string) => Promise<{ ok: boolean }>, success: string) {
    const ids = [...selected];
    await run(
      async () => {
        for (const id of ids) {
          const r = await action(id);
          if (!r.ok) return r as { ok: false; error: string };
        }
        return { ok: true as const };
      },
      { key: "bulk", refresh: false, success },
    );
    setSelected(new Set());
  }

  const describe = (id: string) => {
    const c = backlog.find((x) => x.id === id);
    return c ? `${c.key} ${c.title}` : "the item";
  };
  const active = activeId ? backlog.find((c) => c.id === activeId) : null;
  const sprintOptions = sprints.map((s) => ({ id: s.id, name: `${s.name}${s.status === "active" ? " (active)" : ""}` }));

  return (
    <div className="flex flex-col gap-8">
      {view.plannedSprints.map(({ sprint, cards }) => (
        <Section
          key={sprint.id}
          title={sprint.name}
          icon={CalendarRange}
          count={cards.length}
          description={`${sprintTiming(sprint)} · planned`}
          actions={
            <Link href={WORK.sprints(slug)} className="text-sm text-muted-foreground hover:text-primary">
              Sprints →
            </Link>
          }
        >
          {cards.length === 0 ? (
            <EmptyState compact title="Nothing planned yet" description="Select backlog items below and add them to this sprint." />
          ) : (
            <ol className="divide-y rounded-lg border bg-card">
              {cards.map((c) => (
                <Row key={c.id} card={c} slug={slug} assignees={view.assignees} run={run} isPending={isPending} showStatus />
              ))}
            </ol>
          )}
          <SprintProgress done={cards.filter((c) => c.status === "done").length} total={cards.length} className="max-w-xs" />
        </Section>
      ))}

      {mode === "sprints" && view.unscheduled.length > 0 && (
        <Section title="Unscheduled" description="on the board, in no sprint" count={view.unscheduled.length}>
          <ol className="divide-y rounded-lg border bg-card">
            {view.unscheduled.map((c) => (
              <Row key={c.id} card={c} slug={slug} assignees={view.assignees} run={run} isPending={isPending} showStatus />
            ))}
          </ol>
        </Section>
      )}

      <Section
        title="Backlog"
        icon={Inbox}
        count={backlog.length}
        description="drag to prioritise"
        actions={
          selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{selected.size} selected</span>
              {sprints.length > 0 && (
                <>
                  <RefSelect value={targetSprint} options={sprintOptions} noneLabel="Pick a sprint" onChange={setTargetSprint} ariaLabel="Target sprint" className="w-44" />
                  <Button size="sm" variant="outline" disabled={!targetSprint || pending} onClick={() => bulk((id) => setItemSprintAction({ itemId: id, sprintId: targetSprint }), `Added to sprint`)}>
                    Add to sprint
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" disabled={pending} onClick={() => bulk((id) => moveItemAction({ itemId: id, status: "todo" }), "Moved to the board")}>
                Move to board <ArrowRight className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
          )
        }
      >
        <div className="flex flex-col gap-2">
          <form
            ref={formRef}
            className="flex gap-2"
            action={async (fd) => {
              const title = String(fd.get("title") ?? "").trim();
              if (!title) return;
              formRef.current?.reset();
              addPending(title);
              await run(() => createItemAction({ boardId, title, status: "backlog" }), { key: "quick-add", refresh: false });
            }}
          >
            <Input name="title" placeholder="New backlog item… (Enter to add)" aria-label="New backlog item" className="h-9" autoComplete="off" />
            <Button type="submit" size="sm" variant="outline" disabled={isPending("quick-add")}>Add</Button>
          </form>

          {backlog.length === 0 && pendingTitles.length === 0 ? (
            <EmptyState icon={Inbox} title="Backlog is empty" description="Add ideas, requests and bugs here, then pull them onto the board or into a sprint." />
          ) : (
            <DndContext
              id="backlog-dnd"
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={(e) => setActiveId(String(e.active.id))}
              onDragEnd={onDragEnd}
              onDragCancel={() => setActiveId(null)}
              accessibility={{ announcements: boardAnnouncements(describe, () => "the backlog"), screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
            >
              <ol className="divide-y rounded-lg border bg-card">
                <SortableContext items={backlog.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                  {backlog.map((c) => (
                    <SortableRow key={c.id} card={c} slug={slug} assignees={view.assignees} run={run} isPending={isPending} selected={selected.has(c.id)} onSelect={(on) => toggle(c.id, on)} reducedMotion={reducedMotion} />
                  ))}
                </SortableContext>
                {pendingTitles.map((t, i) => (
                  <li key={`pending-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm opacity-50">
                    <TypeIcon type="task" />
                    <span className="font-mono text-xs text-muted-foreground">…</span>
                    <span className="text-heading">{t}</span>
                  </li>
                ))}
              </ol>
              <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
                {active ? (
                  <ol className="rounded-lg border bg-card shadow-lg ring-2 ring-primary/40">
                    <Row card={active} slug={slug} assignees={view.assignees} run={run} isPending={isPending} />
                  </ol>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </Section>
    </div>
  );
}

type Run = ReturnType<typeof useAction>["run"];

function Row({
  card,
  slug,
  assignees,
  run,
  isPending,
  showStatus,
  handle,
  selected,
  onSelect,
  className,
}: {
  card: WorkCardDto;
  slug: string;
  assignees: WorkUserRef[];
  run: Run;
  isPending: (k: string) => boolean;
  showStatus?: boolean;
  handle?: React.ReactNode;
  selected?: boolean;
  onSelect?: (on: boolean) => void;
  className?: string;
}) {
  const busy = isPending(`row:${card.id}`);
  const patch = (p: Parameters<typeof updateItemAction>[0]["patch"]) => run(() => updateItemAction({ itemId: card.id, patch: p }), { key: `row:${card.id}`, refresh: false });
  return (
    <li className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-sm", className)}>
      {handle}
      {onSelect && <Checkbox checked={!!selected} onCheckedChange={(v) => onSelect(v === true)} aria-label={`Select ${card.key}`} />}
      <TypeSelect value={card.type} onChange={(v) => void patch({ type: v })} disabled={busy} className="w-9 px-1.5 [&>span]:hidden" ariaLabel={`Type of ${card.key}`} />
      <Link href={WORK.item(slug, card.number)} className="font-mono text-xs text-muted-foreground hover:text-primary">{card.key}</Link>
      <Link href={WORK.item(slug, card.number)} className="min-w-0 flex-1 truncate font-medium text-heading hover:text-primary">{card.title}</Link>
      {showStatus && <StatusBadge kind="workItem" status={card.status} className="text-[10px]" />}
      {card.requester && (
        <Badge variant="outline" className="gap-1 text-[10px]" title="Requested by this client">
          <Building2 className="size-3" /> {card.requester.tenantName}
        </Badge>
      )}
      {pointsLabel(card.estimatePoints) && <span className="text-xs tabular-nums text-muted-foreground">{pointsLabel(card.estimatePoints)}</span>}
      <PrioritySelect value={card.priority} onChange={(v) => void patch({ priority: v })} disabled={busy} className="w-24" ariaLabel={`Priority of ${card.key}`} />
      <AssigneeSelect
        value={card.assignee?.id ?? null}
        assignees={assignees}
        disabled={busy}
        className="w-32"
        onChange={(v) => void run(() => assignItemAction({ itemId: card.id, assigneeUserId: v }), { key: `row:${card.id}`, refresh: false })}
        ariaLabel={`Assignee of ${card.key}`}
      />
      {card.assignee && <UserAvatar name={card.assignee.name} size="sm" className="hidden sm:flex" />}
      {card.status === "backlog" && (
        <Button
          size="xs"
          variant="ghost"
          title="Move to the board (To do)"
          disabled={busy}
          onClick={() => void run(() => moveItemAction({ itemId: card.id, status: "todo" }), { key: `row:${card.id}`, refresh: false, success: `${card.key} is on the board` })}
        >
          To do <ArrowRight className="size-3" />
        </Button>
      )}
    </li>
  );
}

function SortableRow(props: Parameters<typeof Row>[0] & { reducedMotion: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: props.card.id,
    transition: props.reducedMotion ? null : undefined,
  });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition: props.reducedMotion ? undefined : transition }} className={cn(isDragging && "opacity-40")}>
      <Row
        {...props}
        handle={
          <button
            ref={setActivatorNodeRef}
            type="button"
            className="cursor-grab touch-manipulation rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label={`Reorder ${props.card.key}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        }
      />
    </div>
  );
}
