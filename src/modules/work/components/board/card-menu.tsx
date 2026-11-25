"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, Copy, ExternalLink, Flag, Image as ImageIcon, Link2, MoreHorizontal, Network, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { WORK } from "@/lib/routes";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cardMenuDataAction, rankItemInColumnAction, setItemCoverAction, setItemParentAction, setItemSprintAction, updateItemAction } from "../../actions";
import { STATUS_LABELS, WORKFLOW } from "../../transitions";
import { parseLabels } from "../labels";
import { LinkForm } from "../item/item-links";
import { useWorkTransitions } from "../transition-host";
import type { BoardCard } from "./item-card";

type MenuData = { epics: { id: string; key: string; title: string }[]; images: { id: string; fileName: string }[]; labels: string[]; parentId: string | null; coverId: string | null };

/** Keeps clicks and keys inside a dialog from reaching the card underneath (open on click, drag on keys). */
const shield = {
  "data-card-control": "",
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
};

/**
 * Jira's card ⋯ menu: Move work item ›, Change status ›, Copy link / key,
 * flag, label, link, parent, cover ›, and Remove from sprint. Epics, images
 * and labels load when a menu that needs them opens.
 */
export function CardMenu({ card, href }: { card: BoardCard; href: string }) {
  const router = useRouter();
  const transitions = useWorkTransitions();
  const { run } = useAction();
  const [data, setData] = useState<MenuData | null>(null);
  const [dialog, setDialog] = useState<"label" | "link" | "parent" | null>(null);
  const subject = { id: card.id, key: card.key, type: card.type, status: card.status, title: card.title };
  const slug = card.product?.slug;

  async function load() {
    if (data) return data;
    const res = await cardMenuDataAction(card.id);
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    setData(res);
    return res;
  }
  const rank = (to: "top" | "up" | "down" | "bottom") => void run(() => rankItemInColumnAction({ itemId: card.id, to }), { key: `rank:${to}`, refresh: false });
  const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`), () => toast.error("Couldn't copy"));

  return (
    <>
      <DropdownMenu onOpenChange={(o) => o && void load()}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-card-control
            onKeyDown={(e) => e.stopPropagation()}
            aria-label={`Actions for ${card.key}`}
            className="inline-flex size-6 cursor-pointer items-center justify-center rounded-[3px] bg-card text-muted-foreground shadow-xs hover:bg-accent hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" data-card-control onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => router.push(href, { scroll: false })}>
            <ExternalLink className="size-4" /> Open
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move work item</DropdownMenuSubTrigger>
            <DropdownMenuSubContent data-card-control>
              <DropdownMenuItem onSelect={() => rank("top")}>
                <ArrowUpToLine className="size-4" /> Top of column
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => rank("up")}>
                <ChevronUp className="size-4" /> Up
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => rank("down")}>
                <ChevronDown className="size-4" /> Down
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => rank("bottom")}>
                <ArrowDownToLine className="size-4" /> Bottom of column
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Change status</DropdownMenuSubTrigger>
            <DropdownMenuSubContent data-card-control>
              {WORKFLOW[card.status].map((s) => (
                <DropdownMenuItem key={s} onSelect={() => void transitions.move(subject, s)} className={cn(s === "canceled" && "text-destructive")}>
                  {STATUS_LABELS[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => copy(new URL(slug ? WORK.item(slug, card.number) : href, window.location.origin).toString(), `Link to ${card.key}`)}>
            <Link2 className="size-4" /> Copy link
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copy(card.key, card.key)}>
            <Copy className="size-4" /> Copy key
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void transitions.flag(subject, !card.flag)}>
            <Flag className={cn("size-4", !card.flag && "fill-warning text-warning")} /> {card.flag ? "Remove flag" : "Add flag"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("label")}>
            <Tag className="size-4" /> Add label
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("link")}>
            <Link2 className="size-4" /> Link work item
          </DropdownMenuItem>
          {card.type !== "epic" && (
            <DropdownMenuItem onSelect={() => setDialog("parent")}>
              <Network className="size-4" /> Change parent
            </DropdownMenuItem>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ImageIcon className="size-4" /> Select cover
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent data-card-control className="w-56">
              {!data && <DropdownMenuItem disabled>Loading…</DropdownMenuItem>}
              {data && data.images.length === 0 && <DropdownMenuItem disabled>No images attached — attach one on the item</DropdownMenuItem>}
              {data?.images.map((img) => (
                <DropdownMenuItem
                  key={img.id}
                  onSelect={() => void run(() => setItemCoverAction({ itemId: card.id, attachmentId: img.id }), { key: "cover", refresh: false, success: "Cover set" }).then(() => setData(null))}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- user upload served by the attachment route */}
                  <img src={WORK.attachment(img.id)} alt="" className="size-6 rounded-[2px] object-cover" />
                  <span className="truncate">{img.fileName}</span>
                  {data.coverId === img.id && <span className="ml-auto text-xs text-info">current</span>}
                </DropdownMenuItem>
              ))}
              {card.coverUrl && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void run(() => setItemCoverAction({ itemId: card.id, attachmentId: null }), { key: "cover", refresh: false, success: "Cover removed" }).then(() => setData(null))}>
                    <X className="size-4" /> Remove cover
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {card.sprintId && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void run(() => setItemSprintAction({ itemId: card.id, sprintId: null }), { key: "sprint", refresh: false, success: `${card.key} removed from the sprint` })}>
                Remove from sprint
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "label" && <AddLabelDialog card={card} suggestions={data?.labels ?? []} onClose={() => setDialog(null)} />}
      {dialog === "link" && (
        <Dialog open onOpenChange={(o) => !o && setDialog(null)}>
          <DialogContent className="sm:max-w-xl" {...shield}>
            <DialogHeader>
              <DialogTitle>Link {card.key}</DialogTitle>
              <DialogDescription>{card.title}</DialogDescription>
            </DialogHeader>
            <LinkForm itemId={card.id} onDone={() => setDialog(null)} />
          </DialogContent>
        </Dialog>
      )}
      {dialog === "parent" && <ParentDialog card={card} data={data} onClose={() => setDialog(null)} />}
    </>
  );
}

function AddLabelDialog({ card, suggestions, onClose }: { card: BoardCard; suggestions: string[]; onClose: () => void }) {
  const { run, isPending } = useAction();
  const [value, setValue] = useState("");
  const offered = suggestions.filter((l) => !card.labels.includes(l) && l.toLowerCase().includes(value.trim().toLowerCase())).slice(0, 12);

  async function add(raw: string) {
    const next = [...new Set([...card.labels, ...parseLabels(raw)])];
    if (next.length === card.labels.length) return onClose();
    const res = await run(() => updateItemAction({ itemId: card.id, patch: { labels: next } }), { key: "label", refresh: false, success: "Label added" });
    if (res?.ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" {...shield}>
        <DialogHeader>
          <DialogTitle>Add label to {card.key}</DialogTitle>
          <DialogDescription>{card.labels.length ? `Current: ${card.labels.join(", ")}` : "No labels yet."}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && value.trim()) void add(value);
          }}
          placeholder="e.g. payments, regression (comma for several)"
          aria-label="Label"
        />
        {offered.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {offered.map((l) => (
              <button key={l} type="button" className="cursor-pointer rounded-[3px] bg-muted px-2 py-0.5 text-xs font-medium hover:bg-accent" onClick={() => void add(l)}>
                {l}
              </button>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" className="cursor-pointer" onClick={onClose}>
            Cancel
          </Button>
          <Button className="cursor-pointer rounded-[3px] bg-info text-white hover:bg-info/90 dark:text-background" disabled={!value.trim() || isPending("label")} onClick={() => void add(value)}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ParentDialog({ card, data, onClose }: { card: BoardCard; data: MenuData | null; onClose: () => void }) {
  const { run, isPending } = useAction();
  const [q, setQ] = useState("");
  const epics = (data?.epics ?? []).filter((e) => `${e.key} ${e.title}`.toLowerCase().includes(q.trim().toLowerCase()));
  const pick = async (parentId: string | null) => {
    const res = await run(() => setItemParentAction({ itemId: card.id, parentId }), { key: "parent", refresh: false, success: parentId ? "Parent changed" : "Removed from its epic" });
    if (res?.ok) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" {...shield}>
        <DialogHeader>
          <DialogTitle>Change parent of {card.key}</DialogTitle>
          <DialogDescription>Pick the epic this item belongs to (same board).</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search epics" aria-label="Search epics" />
        <ul className="max-h-72 overflow-y-auto rounded-[3px] border">
          {!data && <li className="px-3 py-2 text-sm text-muted-foreground">Loading…</li>}
          {data && epics.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No epics on this board yet.</li>}
          {epics.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                disabled={isPending("parent")}
                className={cn("flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent", data?.parentId === e.id && "bg-info/10")}
                onClick={() => void pick(e.id)}
              >
                <span className="shrink-0 text-xs font-semibold text-muted-foreground">{e.key}</span>
                <span className="truncate">{e.title}</span>
                {data?.parentId === e.id && <span className="ml-auto text-xs text-info">current</span>}
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          {card.epic && (
            <Button variant="outline" className="mr-auto cursor-pointer" disabled={isPending("parent")} onClick={() => void pick(null)}>
              Remove parent
            </Button>
          )}
          <Button variant="ghost" className="cursor-pointer" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
