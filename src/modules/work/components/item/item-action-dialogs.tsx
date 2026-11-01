"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WORK } from "@/lib/routes";
import { useAction } from "@/lib/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cloneItemAction, moveItemToBoardAction } from "../../actions";
import type { WorkItemDetailDto } from "../../dto";
import { cloneTitle } from "../../link-logic";
import { RefSelect } from "../pickers";
import { usePeekHref } from "../peek-link";

const PRIMARY = "cursor-pointer rounded-[3px] bg-info text-white hover:bg-info/90 dark:text-background";

/** Jira's Clone: the summary (prefilled "CLONE - …") and what to bring along; opens the copy. */
export function CloneItemDialog({ item, slug, open, onOpenChange }: { item: WorkItemDetailDto; slug: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const peek = usePeekHref();
  const { run, isPending } = useAction();
  const [title, setTitle] = useState(cloneTitle(item.title));
  const [withFiles, setWithFiles] = useState(true);
  const [withLinks, setWithLinks] = useState(true);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await run(() => cloneItemAction({ itemId: item.id, title, includeAttachments: withFiles, includeLinks: withLinks }), {
      key: "clone",
      refresh: false,
      success: (r) => `${r.key} created as a clone of ${item.key}`,
    });
    if (res?.ok) {
      onOpenChange(false);
      router.push(peek.open(slug, res.number), { scroll: false });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Clone {item.key}</DialogTitle>
            <DialogDescription>A copy on the same board with the same fields, linked to the original as “clones”.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="clone-title">Summary</Label>
            <Input id="clone-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required autoFocus />
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox checked={withFiles} onCheckedChange={(v) => setWithFiles(v === true)} disabled={item.attachments.length === 0} />
              Attachments{item.attachments.length ? ` (${item.attachments.length})` : " — none"}
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox checked={withLinks} onCheckedChange={(v) => setWithLinks(v === true)} disabled={item.links.length === 0} />
              Links{item.links.length ? ` (${item.links.length})` : " — none"}
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" className="cursor-pointer" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className={PRIMARY} disabled={!title.trim() || isPending("clone")}>
              {isPending("clone") ? "Cloning…" : "Clone"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Jira's Move: pick another company's board; the item gets that board's next key and the old key redirects. */
export function MoveItemDialog({ item, slug, open, onOpenChange }: { item: WorkItemDetailDto; slug: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const { run, isPending } = useAction();
  const targets = item.moveTargets.filter((b) => b.slug !== slug);
  const [target, setTarget] = useState<string | null>(null);
  const chosen = targets.find((b) => b.slug === target) ?? null;
  const epicWithChildren = item.type === "epic" && item.children.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    const res = await run(() => moveItemToBoardAction({ itemId: item.id, targetSlug: target }), {
      key: "move",
      refresh: false,
      success: (r) => `${item.key} moved — it's now ${r.key}`,
    });
    if (res?.ok) {
      onOpenChange(false);
      router.push(WORK.item(res.slug, res.number));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Move {item.key}</DialogTitle>
            <DialogDescription>Move this item to another company&apos;s board. It gets that board&apos;s next key; links to {item.key} keep working.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>Board</Label>
            <RefSelect
              value={target}
              options={targets.map((b) => ({ id: b.slug, name: `${b.name} (${b.keyPrefix})` }))}
              noneLabel="Choose a board…"
              onChange={setTarget}
              ariaLabel="Target board"
              className="h-9 w-full"
            />
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {chosen && (
              <li>
                {item.key} becomes <span className="font-medium text-foreground">{chosen.keyPrefix}-…</span>, the next number on that board.
              </li>
            )}
            <li>Comments, history, attachments, links, watchers and the assignee move with it.</li>
            {item.sprint && <li>It leaves its sprint ({item.sprint.name}).</li>}
            {item.epic && <li>It leaves its epic ({item.epic.key}); epics belong to one board.</li>}
          </ul>
          {epicWithChildren && (
            <p className="rounded-[3px] border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
              This epic still has child items. Move them, or take them out of the epic, first.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" className="cursor-pointer" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className={PRIMARY} disabled={!target || epicWithChildren || isPending("move")}>
              {isPending("move") ? "Moving…" : "Move"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
