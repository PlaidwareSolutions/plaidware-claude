"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createItemAction } from "../actions";
import type { WorkItemPriority, WorkItemSource, WorkItemType } from "../contracts";
import type { WorkEpicRef, WorkUserRef } from "../dto";
import { EpicLozenge } from "./item-bits";
import { WORK } from "@/lib/routes";
import { useAction } from "@/lib/use-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isRichTextEmpty } from "../rich-text";
import { RichEditor } from "./editor/rich-editor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseLabels } from "./labels";
import { AssigneeSelect, PrioritySelect, RefSelect, SourceSelect, TypeSelect } from "./pickers";

type Form = {
  title: string;
  type: WorkItemType;
  priority: WorkItemPriority;
  description: string;
  assigneeUserId: string | null;
  estimate: string;
  labels: string;
  status: "backlog" | "todo";
  source: WorkItemSource;
  requesterTenantId: string | null;
  parentId: string | null;
};

const NO_EPIC = "__none";

const empty = (status: "backlog" | "todo"): Form => ({
  title: "",
  type: "task",
  priority: "medium",
  description: "",
  assigneeUserId: null,
  estimate: "",
  labels: "",
  status,
  source: "internal",
  requesterTenantId: null,
  parentId: null,
});

/**
 * Create an item on this board. Ops can also record which client asked for
 * it; that field never renders for developers and the server ignores it
 * from anyone but ops. Opens on mount when the URL carries ?new=1.
 */
export function NewItemDialog({
  boardId,
  slug,
  assignees,
  canLinkClient,
  tenants = [],
  defaultStatus = "backlog",
  trigger,
  boards,
  defaultBoardSlug,
  hotkey,
  epics = [],
}: {
  /** One product's board — or pass `boards` to pick the company in the dialog. */
  boardId?: string;
  slug?: string;
  assignees: WorkUserRef[];
  canLinkClient: boolean;
  tenants?: { id: string; name: string }[];
  defaultStatus?: "backlog" | "todo";
  trigger?: React.ReactNode;
  boards?: { boardId: string; slug: string; name: string; color: string | null }[];
  defaultBoardSlug?: string;
  /** "c" opens the dialog (Jira's create shortcut). */
  hotkey?: boolean;
  /** Epics to file the item under (with productSlug on the cross-company board, filtered to the chosen company). */
  epics?: (WorkEpicRef & { productSlug?: string })[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { run, isPending } = useAction();
  // ?new=1 opens the dialog (deep link from the ops product page); closing it clears the param.
  const requested = params.get("new") === "1";
  const [manualOpen, setManualOpen] = useState(false);
  const open = manualOpen || requested;
  const [form, setForm] = useState<Form>(() => empty(defaultStatus));
  // Bumped after a create so the description editor starts empty again.
  const [round, setRound] = useState(0);
  const [targetSlug, setTargetSlug] = useState(defaultBoardSlug ?? boards?.[0]?.slug ?? slug ?? "");
  const target = boards?.find((b) => b.slug === targetSlug);
  const targetBoardId = target?.boardId ?? boardId;
  const boardEpics = epics.filter((e) => !e.productSlug || e.productSlug === targetSlug);
  const busy = isPending("new-item");
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "c" || e.metaKey || e.ctrlKey || e.altKey || el?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      e.preventDefault();
      setManualOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);

  function setOpen(v: boolean) {
    setManualOpen(v);
    if (!v && requested) router.replace(pathname);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const estimate = form.estimate.trim() === "" ? null : Number(form.estimate);
    if (!targetBoardId) return;
    const res = await run(
      () =>
        createItemAction({
          boardId: targetBoardId,
          title: form.title,
          type: form.type,
          priority: form.priority,
          description: form.description,
          assigneeUserId: form.assigneeUserId,
          estimatePoints: Number.isFinite(estimate) ? estimate : null,
          labels: parseLabels(form.labels),
          parentId: form.type === "epic" ? null : form.parentId,
          status: form.status,
          source: canLinkClient ? form.source : undefined,
          requesterTenantId: canLinkClient ? form.requesterTenantId : undefined,
        }),
      { key: "new-item", refresh: false },
    );
    if (res?.ok) {
      const { key, number } = res;
      toast.success(`${key} created`, { action: { label: "Open", onClick: () => router.push(WORK.item(target?.slug ?? slug ?? "", number)) } });
      setOpen(false);
      setForm(empty(defaultStatus));
      setRound((r) => r + 1);
    }
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>
        {trigger ?? (
          <Button size="sm" className="gap-2">
            <Plus className="size-4" /> New item
          </Button>
        )}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>New item</DialogTitle>
              <DialogDescription>A feature, enhancement, bug or task for this product&apos;s board.</DialogDescription>
            </DialogHeader>
            {boards && (
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={targetSlug} onValueChange={setTargetSlug}>
                  <SelectTrigger className="w-full" aria-label="Company"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {boards.map((b) => (
                      <SelectItem key={b.slug} value={b.slug}>
                        <span className="inline-flex items-center gap-2">
                          <span className="size-2.5 rounded-full" style={{ background: b.color ?? "var(--primary)" }} />
                          {b.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="ni-title">Title</Label>
              <Input id="ni-title" autoFocus required value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="What needs doing?" />
            </div>
            <div className="grid items-start gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label>Type</Label>
                <TypeSelect size="default" className="w-full" value={form.type} onChange={(v) => set("type", v)} />
              </div>
              <div className="grid gap-2">
                <Label>Priority</Label>
                <PrioritySelect size="default" className="w-full" value={form.priority} onChange={(v) => set("priority", v)} />
              </div>
              <div className="grid gap-2">
                <Label>Add to</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v as Form["status"])}>
                  <SelectTrigger className="w-full" aria-label="Add to"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="backlog">Backlog</SelectItem>
                    <SelectItem value="todo">Board (to do)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.type !== "epic" && boardEpics.length > 0 && (
              <div className="grid gap-2">
                <Label>Epic</Label>
                <Select value={form.parentId ?? NO_EPIC} onValueChange={(v) => set("parentId", v === NO_EPIC ? null : v)}>
                  <SelectTrigger className="w-full" aria-label="Epic"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_EPIC}>No epic</SelectItem>
                    {boardEpics.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        <EpicLozenge epic={e} /> <span className="text-xs text-muted-foreground">{e.key}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label>Description</Label>
              <RichEditor
                key={round}
                initialHtml=""
                ariaLabel="Description"
                placeholder="Context, steps, acceptance criteria… paste screenshots straight in."
                minHeight="min-h-28"
                onChange={(html) => set("description", isRichTextEmpty(html) ? "" : html)}
              />
            </div>
            <div className="grid items-start gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label>Assignee</Label>
                <AssigneeSelect size="default" className="w-full" value={form.assigneeUserId} assignees={assignees} onChange={(v) => set("assigneeUserId", v)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ni-points">Points</Label>
                <Input id="ni-points" type="number" min={0} max={100} value={form.estimate} onChange={(e) => set("estimate", e.target.value)} placeholder="—" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ni-labels">Labels</Label>
                <Input id="ni-labels" value={form.labels} onChange={(e) => set("labels", e.target.value)} placeholder="auth, ui" />
              </div>
            </div>
            {canLinkClient && (
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Source</Label>
                  <SourceSelect size="default" className="w-full" value={form.source} onChange={(v) => set("source", v)} />
                </div>
                <div className="grid gap-2">
                  <Label>Requesting client</Label>
                  <RefSelect size="default" className="w-full" value={form.requesterTenantId} options={tenants} noneLabel="None" onChange={(v) => set("requesterTenantId", v)} ariaLabel="Requesting client" />
                  <p className="text-[11px] text-muted-foreground">Developers see this only if they&apos;re on the client&apos;s workspace. Keep client names out of titles and comments.</p>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="submit" disabled={busy || !form.title.trim()}>
                {busy ? "Creating…" : "Create item"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
