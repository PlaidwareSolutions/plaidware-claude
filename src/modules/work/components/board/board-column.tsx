"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { WorkItemStatus } from "../../contracts";
import type { WorkCardDto } from "../../dto";
import { ItemCard } from "./item-card";

export const columnDroppableId = (status: WorkItemStatus) => `col:${status}`;

export function BoardColumn({
  status,
  label,
  caption,
  wipLimit,
  cards,
  slug,
  reducedMotion,
}: {
  status: WorkItemStatus;
  label: string;
  caption?: string;
  wipLimit: number | null;
  cards: WorkCardDto[];
  slug: string;
  reducedMotion: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnDroppableId(status), data: { type: "column", status } });
  const over = wipLimit != null && cards.length > wipLimit;
  const headingId = `col-${status}-heading`;
  return (
    <section className="flex w-72 shrink-0 snap-start flex-col gap-2 lg:w-auto lg:min-w-64 lg:flex-1" aria-labelledby={headingId}>
      <div className={cn("flex items-center gap-2 px-1", over && "text-warning")} title={over ? "Over the WIP limit" : undefined}>
        <h3 id={headingId} className="text-sm font-semibold text-heading">
          {label}
        </h3>
        <Badge variant={over ? "warning" : "outline"} className="text-[10px] tabular-nums">
          {cards.length}
          {wipLimit != null ? `/${wipLimit}` : ""}
        </Badge>
        {caption && <span className="ml-auto text-[11px] text-muted-foreground">{caption}</span>}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 rounded-lg bg-accent/40 p-2 transition-shadow",
          isOver && "ring-2 ring-primary/40",
        )}
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((c) => (
            <ItemCard key={c.id} card={c} slug={slug} reducedMotion={reducedMotion} />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed py-6 text-xs text-muted-foreground">
            Drop here
          </div>
        )}
      </div>
    </section>
  );
}
