"use client";

import { Ban, ListChecks } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import type { WorkItemStatus } from "../../contracts";
import { ItemCard, type BoardCard, type CardLinkMode } from "./item-card";

export const columnDroppableId = (status: WorkItemStatus) => `col:${status}`;

/** Jira's column count: a small grey box ("TO DO [2]"), amber when over the WIP limit. */
export function ColumnCount({ count, wipLimit, over }: { count: number; wipLimit?: number | null; over?: boolean }) {
  return (
    <span className={cn("rounded-[3px] bg-foreground/10 px-1.5 py-px text-[11px] font-semibold tabular-nums tracking-normal text-foreground/70", over && "bg-warning/20 text-warning")}>
      {count}
      {wipLimit != null ? ` / ${wipLimit}` : ""}
    </span>
  );
}

/** Where the held card may go: its own column, a column the workflow allows, or one it doesn't (⊘). */
export type DropState = "origin" | "allowed" | "blocked";

export function BoardColumn({
  status,
  label,
  caption,
  wipLimit,
  cards,
  slug,
  reducedMotion,
  linkMode,
  footer,
  hideHeader,
  dropState,
  hovered,
}: {
  status: WorkItemStatus;
  label: string;
  caption?: string;
  wipLimit: number | null;
  cards: BoardCard[];
  slug: string;
  reducedMotion: boolean;
  linkMode?: CardLinkMode;
  /** Rendered under the cards (the inline "Create" on the cross-product board). */
  footer?: React.ReactNode;
  hideHeader?: boolean;
  /** While a card is dragged: can this column take it (workflow)? undefined when nothing is dragged. */
  dropState?: DropState;
  /** The dragged card is over this column. */
  hovered?: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: columnDroppableId(status), data: { type: "column", status } });
  const over = wipLimit != null && cards.length > wipLimit;
  const blocked = dropState === "blocked";
  const headingId = `col-${status}-heading`;
  return (
    <section
      className={cn(
        "relative flex w-[272px] shrink-0 snap-start flex-col rounded-md bg-board-column transition-[opacity,box-shadow] lg:w-auto lg:min-w-0 lg:flex-1",
        over && "bg-warning/10",
        blocked && "cursor-not-allowed opacity-60",
        blocked && hovered && "opacity-80 ring-2 ring-destructive/50",
      )}
      {...(hideHeader ? { "aria-label": label } : { "aria-labelledby": headingId })}
    >
      <div
        className={cn("flex h-11 items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground", hideHeader && "lg:hidden")}
        title={over ? "Over the WIP limit" : undefined}
      >
        <h3 id={hideHeader ? undefined : headingId}>{label}</h3>
        <ColumnCount count={cards.length} wipLimit={wipLimit} over={over} />
        {status === "done" && <ListChecks className="size-4 text-success" aria-label="Done column" />}
        {caption && <span className="ml-auto text-[11px] font-normal normal-case tracking-normal">{caption}</span>}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-1.5 rounded-md px-1.5 pb-1.5 transition-shadow",
          hideHeader && "pt-1.5 lg:pt-1.5",
          dropState === "allowed" && "outline-2 -outline-offset-4 outline-dashed outline-info/50",
          dropState === "allowed" && hovered && "bg-info/10 outline-info",
        )}
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((c) => (
            <ItemCard key={c.id} card={c} slug={slug} reducedMotion={reducedMotion} linkMode={linkMode} />
          ))}
        </SortableContext>
        {cards.length === 0 && !footer && !dropState && <div className="flex-1 py-6" aria-hidden />}
        {dropState === "allowed" && (
          <div className="flex flex-1 items-start justify-center pt-3 text-xs font-semibold text-info" aria-hidden>
            Drop here
          </div>
        )}
        {footer}
      </div>
      {blocked && (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center rounded-md pt-16" aria-hidden>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1.5 text-xs font-semibold shadow-sm", hovered ? "text-destructive" : "text-muted-foreground")}>
            <Ban className="size-4" /> Not allowed
          </span>
        </div>
      )}
    </section>
  );
}
