"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CalendarClock, Check, ExternalLink, Flag, Link2, MessageSquare, MoreHorizontal, Pencil, Search, UserRound } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { WORK } from "@/lib/routes";
import { formatDay, isoDay } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { assignItemAction, updateItemAction } from "../../actions";
import type { WorkCardDto, WorkProductRef, WorkUserRef } from "../../dto";
import { isOverdue } from "../../explorer-logic";
import { RESOLUTION_LABELS, STATUS_LABELS, WORKFLOW } from "../../transitions";
import { EpicLozenge, LabelChips, PointsPill, PriorityIcon, TypeIcon } from "../item-bits";
import { usePeekHref } from "../peek-link";
import { useWorkTransitions } from "../transition-host";
import { useCardFields } from "./card-fields";
import { wasJustDragged } from "./use-board-dnd";

/** A card on a product board, or on the cross-product board (which also knows the product). */
export type BoardCard = WorkCardDto & { product?: WorkProductRef };
/** "page" links to the item page; "peek" opens the quick-view panel over the board. */
export type CardLinkMode = "page" | "peek";

/** Who can be assigned from a card's avatar (set by the board; without it the avatar is just a picture). */
const BoardPeopleCtx = createContext<{ assignees: WorkUserRef[]; viewerId: string } | null>(null);
export function BoardPeopleProvider({ assignees, viewerId, children }: { assignees: WorkUserRef[]; viewerId: string; children: React.ReactNode }) {
  return <BoardPeopleCtx.Provider value={{ assignees, viewerId }}>{children}</BoardPeopleCtx.Provider>;
}

/**
 * The card face, laid out like Jira's: title, then the epic lozenge and any
 * tags, then type · key on the left and estimate · priority · assignee on the
 * right. Clicking anywhere opens the item; on hover a ✎ renames it in place and
 * the ⋯ menu moves / flags it. Also rendered in the DragOverlay (`dragging`).
 */
export function ItemCardBody({
  card,
  slug,
  dragging,
  blocked,
  linkMode = "page",
}: {
  card: BoardCard;
  slug: string;
  dragging?: boolean;
  /** Overlay only: hovering a column the workflow doesn't allow. */
  blocked?: boolean;
  linkMode?: CardLinkMode;
}) {
  const router = useRouter();
  const peek = usePeekHref();
  const fields = useCardFields();
  const [renaming, setRenaming] = useState(false);
  const productSlug = card.product?.slug ?? slug;
  const href = linkMode === "peek" ? peek.open(productSlug, card.number) : WORK.item(productSlug, card.number);
  const overdue = isOverdue(card, isoDay());
  const done = card.status === "done";
  const showEpic = fields.epic && !!card.epic;
  const showLabels = fields.labels && card.labels.length > 0;
  const showClient = fields.client && !!card.requester;
  const showDue = fields.dueDate && !!card.dueOn;

  function open(e: React.MouseEvent) {
    // Ignore the click that ends a drag, clicks in the card's own controls (portals bubble through React), and renaming.
    if (renaming || dragging || wasJustDragged() || !e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest("[data-card-control]")) return;
    if ((e.target as HTMLElement).closest("a")) return; // the title link navigates itself
    router.push(href, { scroll: false });
  }

  return (
    <div
      onClick={open}
      className={cn(
        "group/card relative flex cursor-pointer flex-col gap-2 rounded-md bg-card px-3 pb-2.5 pt-3 text-sm shadow-board-card transition-colors hover:bg-accent/60",
        card.flag && "bg-warning/15 hover:bg-warning/20",
        dragging && "rotate-1 cursor-grabbing shadow-lg ring-2 ring-info/50",
        blocked && "cursor-not-allowed opacity-80 ring-2 ring-destructive/60",
      )}
    >
      {renaming ? (
        <RenameTitle card={card} onDone={() => setRenaming(false)} />
      ) : (
        <Link href={href} scroll={false} className="line-clamp-3 break-words pr-12 leading-snug text-foreground hover:underline">
          {card.title}
        </Link>
      )}
      {!dragging && !renaming && (
        <div className="absolute right-1.5 top-2 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100 has-data-[state=open]:opacity-100">
          <button
            type="button"
            data-card-control
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
            aria-label={`Rename ${card.key}`}
            title="Edit summary"
            className="inline-flex size-6 items-center justify-center rounded-[3px] bg-card text-muted-foreground shadow-xs hover:bg-accent hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </button>
          <CardMenu card={card} href={href} />
        </div>
      )}
      {(showEpic || showLabels || showClient || showDue) && (
        <div className="flex flex-wrap items-center gap-1">
          {showEpic && <EpicLozenge epic={card.epic!} />}
          {showClient && (
            <Badge className="gap-1 rounded-[3px] border-0 bg-primary/15 px-1 py-0 text-[11px] font-semibold uppercase leading-4 text-primary" title="Requested by this client">
              <Building2 className="size-3" /> {card.requester!.tenantName}
            </Badge>
          )}
          {showLabels && <LabelChips labels={card.labels} />}
          {showDue && (
            <Badge
              variant={overdue ? "destructive" : "secondary"}
              className={cn("gap-1 rounded-[3px] px-1 py-0 text-[11px] font-semibold leading-4", !overdue && "border-0")}
              title={overdue ? "Overdue" : "Due date"}
            >
              <CalendarClock className="size-3" /> {formatDay(card.dueOn!)}
            </Badge>
          )}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <TypeIcon type={card.type} />
          {done && <Check className="size-3.5 shrink-0 text-success" strokeWidth={3} aria-label="Done" />}
          <span className={cn("shrink-0 whitespace-nowrap text-xs font-semibold text-muted-foreground", done && "line-through")}>{card.key}</span>
          {done && card.resolution && card.resolution !== "done" && (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={`Resolution: ${RESOLUTION_LABELS[card.resolution]}`}>
              {RESOLUTION_LABELS[card.resolution]}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {card.flag && (
            <span className="text-warning" title={card.flag.reason ? `Flagged: ${card.flag.reason}` : "Flagged"} aria-label="Flagged">
              <Flag className="size-3.5 fill-current" />
            </span>
          )}
          {card.commentCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground" title={`${card.commentCount} comment${card.commentCount === 1 ? "" : "s"}`}>
              <MessageSquare className="size-3" /> {card.commentCount}
            </span>
          )}
          {fields.estimate && <PointsPill points={card.estimatePoints} showEmpty />}
          <PriorityIcon priority={card.priority} />
          <AssigneeControl card={card} disabled={dragging} />
        </span>
      </div>
    </div>
  );
}

/** ✎ on a card: rename in place (Enter saves, Esc cancels). Drag and card-click are held off while typing. */
function RenameTitle({ card, onDone }: { card: BoardCard; onDone: () => void }) {
  const { run } = useAction();
  const [value, setValue] = useState(card.title);
  async function save() {
    const next = value.trim();
    onDone();
    if (!next || next === card.title) return;
    await run(() => updateItemAction({ itemId: card.id, patch: { title: next } }), { key: `rename:${card.id}`, refresh: false });
  }
  return (
    <textarea
      autoFocus
      data-card-control
      rows={2}
      value={value}
      maxLength={200}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => void save()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          void save();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onDone();
        }
      }}
      aria-label={`Summary of ${card.key}`}
      className="w-full resize-none rounded-[3px] border-2 border-info bg-background px-1.5 py-1 text-sm leading-snug outline-none"
    />
  );
}

function AvatarFace({ name }: { name: string | null }) {
  return name ? (
    <UserAvatar name={name} size="sm" />
  ) : (
    <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <UserRound className="size-3.5" />
    </span>
  );
}

/** Jira's avatar on the card: click to reassign (search, Assign to me, Unassigned). */
function AssigneeControl({ card, disabled }: { card: BoardCard; disabled?: boolean }) {
  const people = useContext(BoardPeopleCtx);
  const { run } = useAction();
  const [query, setQuery] = useState("");
  const name = card.assignee?.name ?? null;
  if (!people || disabled) return <span title={name ?? "Unassigned"}><AvatarFace name={name} /></span>;
  const assign = (id: string | null) =>
    void run(() => assignItemAction({ itemId: card.id, assigneeUserId: id }), { key: `assign:${card.id}`, refresh: false });
  const shown = people.assignees.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <DropdownMenu onOpenChange={(o) => !o && setQuery("")}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-card-control
          onKeyDown={(e) => e.stopPropagation()}
          className="rounded-full outline-none ring-offset-1 transition-shadow hover:ring-2 hover:ring-info/60 focus-visible:ring-2 focus-visible:ring-info"
          aria-label={name ? `Assignee: ${name}. Change` : "Unassigned. Assign"}
          title={name ? `Assignee: ${name}` : "Unassigned — click to assign"}
        >
          <AvatarFace name={name} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" data-card-control onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">Assignee</DropdownMenuLabel>
        <div className="relative px-1 pb-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search people" className="h-8 pl-7" aria-label="Search people" />
        </div>
        {card.assignee?.id !== people.viewerId && (
          <DropdownMenuItem onSelect={() => assign(people.viewerId)} className="font-medium text-info">
            Assign to me
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => assign(null)} className="gap-2">
          <AvatarFace name={null} /> Unassigned
          {!card.assignee && <Check className="ml-auto size-4 text-info" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="max-h-60 overflow-y-auto">
          {shown.map((a) => (
            <DropdownMenuItem key={a.id} onSelect={() => assign(a.id)} className="gap-2">
              <UserAvatar name={a.name} size="sm" /> <span className="truncate">{a.name}</span>
              {card.assignee?.id === a.id && <Check className="ml-auto size-4 text-info" />}
            </DropdownMenuItem>
          ))}
          {shown.length === 0 && <p className="px-2 py-2 text-center text-xs text-muted-foreground">No one matches</p>}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The ⋯ on a hovered card: open, move along the workflow, flag, copy link. */
function CardMenu({ card, href }: { card: BoardCard; href: string }) {
  const router = useRouter();
  const transitions = useWorkTransitions();
  const subject = { id: card.id, key: card.key, type: card.type, status: card.status, title: card.title };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-card-control
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={`Actions for ${card.key}`}
          className="inline-flex size-6 items-center justify-center rounded-[3px] bg-card text-muted-foreground shadow-xs hover:bg-accent hover:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" data-card-control onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => router.push(href, { scroll: false })}>
          <ExternalLink className="size-4" /> Open
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {WORKFLOW[card.status].map((s) => (
              <DropdownMenuItem key={s} onSelect={() => void transitions.move(subject, s)} className={cn(s === "canceled" && "text-destructive")}>
                {STATUS_LABELS[s]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => void transitions.flag(subject, !card.flag)}>
          <Flag className={cn("size-4", !card.flag && "fill-warning text-warning")} /> {card.flag ? "Remove flag" : "Add flag"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            const slug = card.product?.slug;
            const url = new URL(slug ? WORK.item(slug, card.number) : href, window.location.origin).toString();
            void navigator.clipboard.writeText(url).then(() => toast.success(`Link to ${card.key} copied`), () => toast.error("Couldn't copy the link"));
          }}
        >
          <Link2 className="size-4" /> Copy link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ItemCard({
  card,
  slug,
  reducedMotion,
  linkMode,
}: {
  card: BoardCard;
  slug: string;
  reducedMotion: boolean;
  linkMode?: CardLinkMode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: "card", status: card.status },
    transition: reducedMotion ? null : undefined,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition: reducedMotion ? undefined : transition }}
      className={cn("touch-manipulation rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50", isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <ItemCardBody card={card} slug={slug} linkMode={linkMode} />
    </div>
  );
}
