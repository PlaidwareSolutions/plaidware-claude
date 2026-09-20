import Link from "next/link";
import { Building2 } from "lucide-react";
import { WORK } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import type { WorkCardDto } from "../dto";
import { LabelChips, TypeIcon } from "./item-bits";
import { pointsLabel } from "./labels";

/** A compact, link-only row for lists of items (unscheduled, reports, client requests). */
export function ItemRow({ card, slug, showStatus = true, className }: { card: WorkCardDto; slug: string; showStatus?: boolean; className?: string }) {
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm", className)}>
      <TypeIcon type={card.type} />
      <Link href={WORK.item(slug, card.number)} className="font-mono text-xs text-muted-foreground hover:text-primary">
        {card.key}
      </Link>
      <Link href={WORK.item(slug, card.number)} className="min-w-0 flex-1 truncate font-medium text-heading hover:text-primary">
        {card.title}
      </Link>
      {showStatus && <StatusBadge kind="workItem" status={card.status} className="text-[10px]" />}
      <StatusBadge kind="workPriority" status={card.priority} className="text-[10px]" />
      <LabelChips labels={card.labels} max={2} />
      {card.requester && (
        <Badge variant="outline" className="gap-1 text-[10px]" title="Requested by this client">
          <Building2 className="size-3" /> {card.requester.tenantName}
        </Badge>
      )}
      {pointsLabel(card.estimatePoints) && <span className="text-xs tabular-nums text-muted-foreground">{pointsLabel(card.estimatePoints)}</span>}
      {card.assignee && <UserAvatar name={card.assignee.name} size="sm" />}
    </li>
  );
}

export function ItemRowList({ cards, slug, showStatus }: { cards: WorkCardDto[]; slug: string; showStatus?: boolean }) {
  return (
    <ol className="divide-y rounded-lg border bg-card">
      {cards.map((c) => (
        <ItemRow key={c.id} card={c} slug={slug} showStatus={showStatus} />
      ))}
    </ol>
  );
}
