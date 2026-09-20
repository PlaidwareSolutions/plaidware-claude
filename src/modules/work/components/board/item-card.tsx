"use client";

import Link from "next/link";
import { Building2, MessageSquare } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { WORK } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import type { WorkCardDto } from "../../dto";
import { LabelChips, TypeIcon } from "../item-bits";
import { pointsLabel } from "../labels";

/** The card face; also rendered inside the DragOverlay. */
export function ItemCardBody({ card, slug, dragging }: { card: WorkCardDto; slug: string; dragging?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm shadow-xs",
        dragging && "shadow-lg ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <TypeIcon type={card.type} />
        <span className="font-mono">{card.key}</span>
        {card.commentCount > 0 && (
          <span className="ml-auto inline-flex items-center gap-0.5">
            <MessageSquare className="size-3" /> {card.commentCount}
          </span>
        )}
      </div>
      <Link href={WORK.item(slug, card.number)} className="line-clamp-2 font-medium text-heading hover:text-primary">
        {card.title}
      </Link>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge kind="workPriority" status={card.priority} className="text-[10px]" />
        <LabelChips labels={card.labels} />
        {card.requester && (
          <Badge variant="outline" className="gap-1 text-[10px]" title="Requested by this client">
            <Building2 className="size-3" /> {card.requester.tenantName}
          </Badge>
        )}
        {pointsLabel(card.estimatePoints) && <span className="text-[10px] tabular-nums text-muted-foreground">{pointsLabel(card.estimatePoints)}</span>}
        {card.assignee && <UserAvatar name={card.assignee.name} size="sm" className="ml-auto" />}
      </div>
    </div>
  );
}

export function ItemCard({ card, slug, reducedMotion }: { card: WorkCardDto; slug: string; reducedMotion: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: "card", status: card.status },
    transition: reducedMotion ? null : undefined,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition: reducedMotion ? undefined : transition }}
      className={cn("cursor-grab touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-lg", isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <ItemCardBody card={card} slug={slug} />
    </div>
  );
}
