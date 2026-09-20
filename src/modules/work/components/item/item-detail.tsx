"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { WORK } from "@/lib/routes";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { deleteItemAction, updateItemAction } from "../../actions";
import type { WorkBoardMode } from "../../contracts";
import type { WorkItemDetailDto } from "../../dto";
import { TypeIcon } from "../item-bits";
import { CommentsSection } from "./comments-section";
import { ItemActivity } from "./item-activity";
import { ItemSidebar } from "./item-sidebar";

/** One work item: editable title and description, fields, comments and history. */
export function ItemDetail({
  slug,
  mode,
  item,
  canManage,
  canLinkClient,
  tenants,
}: {
  slug: string;
  mode: WorkBoardMode;
  item: WorkItemDetailDto;
  canManage: boolean;
  canLinkClient: boolean;
  tenants: { id: string; name: string }[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const { run, isPending } = useAction();

  async function remove() {
    const ok = await confirm({
      title: `Delete ${item.key}?`,
      description: "The item, its comments and its history are removed for good.",
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const res = await run(() => deleteItemAction(item.id), { key: "delete", refresh: false, success: `${item.key} deleted` });
    if (res?.ok) router.push(WORK.board(slug));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <TypeIcon type={item.type} />
            <span className="font-mono">{item.key}</span>
            <StatusBadge kind="workItem" status={item.status} />
            <StatusBadge kind="workType" status={item.type} />
            <StatusBadge kind="workPriority" status={item.priority} />
            {canManage && (
              <Button variant="ghost" size="xs" className="ml-auto text-destructive hover:text-destructive" disabled={isPending("delete")} onClick={remove}>
                <Trash2 className="size-3" /> Delete
              </Button>
            )}
          </div>
          <EditableTitle itemId={item.id} title={item.title} />
        </div>
        <EditableDescription itemId={item.id} description={item.description} />
        <CommentsSection itemId={item.id} comments={item.comments} />
        <ItemActivity events={item.events} />
      </div>
      <ItemSidebar slug={slug} mode={mode} item={item} canLinkClient={canLinkClient} tenants={tenants} />
    </div>
  );
}

function EditableTitle({ itemId, title }: { itemId: string; title: string }) {
  const { run, isPending } = useAction();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);

  async function save() {
    const next = value.trim();
    setEditing(false);
    if (!next || next === title) {
      setValue(title);
      return;
    }
    await run(() => updateItemAction({ itemId, patch: { title: next } }), { key: "title", refresh: false });
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setValue(title);
            setEditing(false);
          }
        }}
        className="h-auto text-xl font-semibold"
        aria-label="Title"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={isPending("title")}
      className="group flex w-full items-start gap-2 text-left text-2xl font-semibold text-heading"
      title="Click to edit"
    >
      <span className="min-w-0">{title}</span>
      <Pencil className="mt-2 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function EditableDescription({ itemId, description }: { itemId: string; description: string }) {
  const { run, isPending } = useAction();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(description);
  const busy = isPending("description");

  async function save() {
    if (value === description) {
      setEditing(false);
      return;
    }
    const res = await run(() => updateItemAction({ itemId, patch: { description: value } }), { key: "description", refresh: false });
    if (res?.ok) setEditing(false);
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Description</h2>
        {!editing && (
          <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
            <Pencil className="size-3" /> Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea autoFocus rows={8} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Context, acceptance criteria, links…" />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setValue(description); setEditing(false); }}>Cancel</Button>
          </div>
        </div>
      ) : description ? (
        <div className="whitespace-pre-wrap rounded-lg border bg-card p-4 text-sm leading-relaxed">{description}</div>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-dashed p-4 text-left text-sm text-muted-foreground hover:border-primary/50">
          Add a description…
        </button>
      )}
    </section>
  );
}
