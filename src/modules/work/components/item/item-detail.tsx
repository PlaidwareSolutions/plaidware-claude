"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WORK } from "@/lib/routes";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { Input } from "@/components/ui/input";
import { deleteItemAction, updateItemAction } from "../../actions";
import { isRichTextEmpty } from "../../rich-text";
import { RichEditor } from "../editor/rich-editor";
import { RichTextView } from "../editor/rich-text-view";
import type { WorkBoardMode } from "../../contracts";
import type { WorkItemDetailDto, WorkUserRef } from "../../dto";
import { TypeIcon } from "../item-bits";
import { ChildIssues } from "./child-issues";
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
  viewer,
  onDeleted,
}: {
  slug: string;
  mode: WorkBoardMode;
  item: WorkItemDetailDto;
  canManage: boolean;
  canLinkClient: boolean;
  tenants: { id: string; name: string }[];
  /** The signed-in user (comment avatar, "Assign to me"). */
  viewer: WorkUserRef | null;
  /** The quick view closes itself; the item page goes back to the board. */
  onDeleted?: () => void;
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
    if (res?.ok) {
      if (onDeleted) onDeleted();
      else router.push(WORK.board(slug));
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)]">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {item.epic && (
              <>
                <TypeIcon type="epic" />
                <span className="font-medium" title={item.epic.title}>{item.epic.key}</span>
                <span aria-hidden>/</span>
              </>
            )}
            <TypeIcon type={item.type} />
            <span className="font-medium">{item.key}</span>
          </div>
          <EditableTitle itemId={item.id} title={item.title} />
        </div>
        <EditableDescription itemId={item.id} description={item.description} />
        {item.type === "epic" && <ChildIssues epicId={item.id} slug={slug} items={item.children} />}
        <ItemActivity itemId={item.id} comments={item.comments} events={item.events} viewer={viewer} />
      </div>
      <ItemSidebar
        mode={mode}
        item={item}
        canLinkClient={canLinkClient}
        tenants={tenants}
        viewer={viewer}
        onDelete={canManage && !isPending("delete") ? () => void remove() : undefined}
      />
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
        className="-mx-2 h-auto rounded-[3px] border-2 border-info px-2 py-1 text-2xl font-medium shadow-none focus-visible:ring-0 md:text-2xl"
        aria-label="Title"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={isPending("title")}
      className="-mx-2 w-[calc(100%+1rem)] rounded-[3px] px-2 py-1 text-left text-2xl font-medium text-heading hover:bg-accent/60"
      title="Click to edit"
    >
      {title}
    </button>
  );
}

/** `description` is server-rendered, sanitised HTML (queries.renderRichText). */
function EditableDescription({ itemId, description }: { itemId: string; description: string }) {
  const { run, isPending } = useAction();
  const [editing, setEditing] = useState(false);
  const busy = isPending("description");

  async function save(html: string) {
    const next = isRichTextEmpty(html) ? "" : html;
    if (next === description || (!next && !description)) {
      setEditing(false);
      return;
    }
    const res = await run(() => updateItemAction({ itemId, patch: { description: next } }), { key: "description", refresh: false });
    if (res?.ok) setEditing(false);
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold text-foreground">Description</h2>
      {editing ? (
        <RichEditor
          initialHtml={description}
          ariaLabel="Description"
          placeholder="Context, steps to reproduce, acceptance criteria… paste screenshots straight in."
          autoFocus
          minHeight="min-h-40"
          onSave={save}
          onCancel={() => setEditing(false)}
          saving={busy}
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setEditing(true)}
          onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && setEditing(true)}
          className="-mx-2 cursor-text rounded-[3px] px-2 py-1.5 text-left hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-info"
          title="Click to edit"
          aria-label="Edit description"
        >
          {description ? <RichTextView html={description} /> : <span className="text-sm text-muted-foreground">Add a description…</span>}
        </div>
      )}
    </section>
  );
}
