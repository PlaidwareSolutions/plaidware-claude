"use client";

import { useOptimistic, useRef, useState } from "react";
import { MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useAction } from "@/lib/use-action";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addCommentAction, deleteCommentAction, editCommentAction } from "../../actions";
import type { WorkCommentDto } from "../../dto";

/** Comments, oldest first, with an optimistic pending row while a new one posts. */
export function CommentsSection({ itemId, comments }: { itemId: string; comments: WorkCommentDto[] }) {
  const { run, isPending } = useAction();
  const [pending, addPending] = useOptimistic<string[], string>([], (list, body) => [...list, body]);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <MessageSquare className="size-4" /> Comments
        {comments.length > 0 && <span className="text-xs font-normal">{comments.length}</span>}
      </h2>
      {comments.length === 0 && pending.length === 0 ? (
        <EmptyState compact icon={MessageSquare} title="No comments yet" description="Decisions, questions and progress notes go here." />
      ) : (
        <ol className="flex flex-col gap-2">
          {comments.map((c) => (
            <Comment key={c.id} comment={c} />
          ))}
          {pending.map((body, i) => (
            <li key={`pending-${i}`} className="rounded-lg border bg-card p-3 text-sm opacity-50">
              <div className="mb-1 text-xs text-muted-foreground">You · posting…</div>
              <div className="whitespace-pre-wrap">{body}</div>
            </li>
          ))}
        </ol>
      )}
      <form
        ref={formRef}
        className="flex flex-col gap-2"
        action={async (fd) => {
          const body = String(fd.get("body") ?? "").trim();
          if (!body) return;
          formRef.current?.reset();
          addPending(body);
          await run(() => addCommentAction({ itemId, body }), { key: "comment", refresh: false });
        }}
      >
        <Textarea name="body" rows={3} placeholder="Write a comment…" aria-label="New comment" />
        <div>
          <Button type="submit" size="sm" disabled={isPending("comment")}>Comment</Button>
        </div>
      </form>
    </section>
  );
}

function Comment({ comment }: { comment: WorkCommentDto }) {
  const { run, isPending } = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const busy = isPending(`c:${comment.id}`);

  async function save() {
    const next = body.trim();
    if (!next || next === comment.body) {
      setBody(comment.body);
      setEditing(false);
      return;
    }
    const res = await run(() => editCommentAction({ commentId: comment.id, body: next }), { key: `c:${comment.id}`, refresh: false });
    if (res?.ok) setEditing(false);
  }

  async function remove() {
    const ok = await confirm({ title: "Delete this comment?", destructive: true, confirmLabel: "Delete" });
    if (!ok) return;
    await run(() => deleteCommentAction(comment.id), { key: `c:${comment.id}`, refresh: false });
  }

  return (
    <li className="rounded-lg border bg-card p-3 text-sm">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        {comment.author && <UserAvatar name={comment.author.name} size="sm" />}
        <span className="font-medium text-heading">{comment.author?.name ?? "Former user"}</span>
        <span title={formatDateTime(comment.createdAt)}>{formatRelative(comment.createdAt)}</span>
        {comment.editedAt && <span title={formatDateTime(comment.editedAt)}>· edited</span>}
        {comment.canEdit && !editing && (
          <span className="ml-auto flex gap-1">
            <Button variant="ghost" size="icon-xs" aria-label="Edit comment" onClick={() => setEditing(true)} disabled={busy}><Pencil className="size-3" /></Button>
            <Button variant="ghost" size="icon-xs" aria-label="Delete comment" onClick={remove} disabled={busy}><Trash2 className="size-3" /></Button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea autoFocus rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setBody(comment.body); setEditing(false); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="whitespace-pre-wrap leading-relaxed">{comment.body}</div>
      )}
    </li>
  );
}
