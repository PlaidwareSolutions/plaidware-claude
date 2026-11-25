"use client";

import { startTransition, useEffect, useOptimistic, useState } from "react";
import { useAction } from "@/lib/use-action";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { useConfirm } from "@/components/confirm-dialog";
import { UserAvatar } from "@/components/user-avatar";
import { addCommentAction, deleteCommentAction, editCommentAction } from "../../actions";
import type { WorkCommentDto, WorkUserRef } from "../../dto";
import { escapeHtml, isRichTextEmpty } from "../../rich-text";
import { RichEditor } from "../editor/rich-editor";
import { RichTextView } from "../editor/rich-text-view";

/**
 * Jira's comment box: an avatar and a one-line "Add a comment…" that opens
 * into the rich editor (formatting, links, pasted screenshots). Press M
 * anywhere on the page to jump in; Ctrl+Enter saves. Posting shows an
 * optimistic row until the server answers.
 */
export function CommentComposer({ itemId, viewer, onPosting }: { itemId: string; viewer: WorkUserRef | null; onPosting: (body: string) => void }) {
  const { run } = useAction();
  const [open, setOpen] = useState(false);
  // Remount the editor after each post so it starts empty.
  const [round, setRound] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key.toLowerCase() !== "m" || e.metaKey || e.ctrlKey || e.altKey || el?.closest("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function save(html: string) {
    if (isRichTextEmpty(html)) return;
    setOpen(false);
    setRound((r) => r + 1);
    // The optimistic row lives as long as this transition (the action's refresh lands the real one).
    startTransition(async () => {
      onPosting(html);
      await run(() => addCommentAction({ itemId, body: html }), { key: "comment", refresh: false });
    });
  }

  return (
    <div className="flex gap-3">
      <UserAvatar name={viewer?.name ?? "You"} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {open ? (
          <RichEditor
            key={round}
            initialHtml=""
            ariaLabel="New comment"
            placeholder="Add a comment…"
            autoFocus
            minHeight="min-h-24"
            media="thumb"
            onSave={save}
            onCancel={() => setOpen(false)}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="h-10 rounded-[3px] border-2 px-3 text-left text-sm text-muted-foreground hover:bg-accent/50"
            >
              Add a comment…
            </button>
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold">Pro tip:</span> press <kbd className="rounded border bg-muted px-1 font-sans text-[11px] font-semibold">M</kbd> to comment
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Optimistic pending rows for comments being posted. */
export function usePendingComments() {
  return useOptimistic<string[], string>([], (list, body) => [...list, body]);
}

/** The viewer's own just-typed comment (editor output), shown until the saved, sanitised one replaces it. */
export function PendingComment({ body, viewer }: { body: string; viewer: WorkUserRef | null }) {
  return (
    <li className="flex gap-3 opacity-50">
      <UserAvatar name={viewer?.name ?? "You"} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-2 text-sm">
          <span className="font-semibold text-foreground">{viewer?.name ?? "You"}</span>
          <span className="text-xs text-muted-foreground">posting…</span>
        </div>
        <RichTextView html={body} />
      </div>
    </li>
  );
}

/**
 * A comment and its replies (one level, Jira-style). Reply opens a box under
 * the thread that starts with an @mention of the person answered.
 */
export function CommentThread({ itemId, comment, replies }: { itemId: string; comment: WorkCommentDto; replies: WorkCommentDto[] }) {
  const { run, isPending } = useAction();
  const [replyTo, setReplyTo] = useState<WorkCommentDto | null>(null);
  const [round, setRound] = useState(0);

  async function send(html: string) {
    if (isRichTextEmpty(html) || !replyTo) return;
    const res = await run(() => addCommentAction({ itemId, body: html, parentId: replyTo.id }), { key: "reply", refresh: false, success: "Reply posted" });
    if (res?.ok) {
      setReplyTo(null);
      setRound((r) => r + 1);
    }
  }

  return (
    <li className="flex flex-col gap-3">
      <CommentItem comment={comment} onReply={() => setReplyTo(comment)} />
      {(replies.length > 0 || replyTo) && (
        <ol className="ml-[2.125rem] flex flex-col gap-3 border-l-2 pl-4">
          {replies.map((r) => (
            <CommentItem key={r.id} comment={r} onReply={() => setReplyTo(r)} />
          ))}
          {replyTo && (
            <li>
              <RichEditor
                key={`${replyTo.id}:${round}`}
                initialHtml={replyStart(replyTo)}
                ariaLabel={`Reply to ${replyTo.author?.name ?? "comment"}`}
                placeholder="Write a reply…"
                autoFocus
                minHeight="min-h-20"
                media="thumb"
                saveLabel="Reply"
                saving={isPending("reply")}
                onSave={send}
                onCancel={() => setReplyTo(null)}
              />
            </li>
          )}
        </ol>
      )}
    </li>
  );
}

/** A reply starts by @mentioning the person answered (as Jira does). */
function replyStart(c: WorkCommentDto): string {
  if (!c.author) return "";
  const name = escapeHtml(c.author.name);
  return `<p><span data-type="mention" data-id="${escapeHtml(c.author.id)}" data-label="${name}">@${name}</span>&nbsp;</p>`;
}

/** `comment.body` is server-rendered, sanitised HTML (queries.renderRichText). */
export function CommentItem({ comment, onReply }: { comment: WorkCommentDto; onReply?: () => void }) {
  const { run, isPending } = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const busy = isPending(`c:${comment.id}`);
  const name = comment.author?.name ?? "Former user";

  async function save(html: string) {
    if (isRichTextEmpty(html) || html === comment.body) {
      setEditing(false);
      return;
    }
    const res = await run(() => editCommentAction({ commentId: comment.id, body: html }), { key: `c:${comment.id}`, refresh: false });
    if (res?.ok) setEditing(false);
  }

  async function remove() {
    const ok = await confirm({ title: "Delete this comment?", description: "Once it's gone, it's gone for good.", destructive: true, confirmLabel: "Delete" });
    if (!ok) return;
    await run(() => deleteCommentAction(comment.id), { key: `c:${comment.id}`, refresh: false });
  }

  return (
    <div className="flex gap-3">
      <UserAvatar name={name} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold text-foreground">{name}</span>
          <span className="text-xs text-muted-foreground" title={formatDateTime(comment.createdAt)}>
            {formatRelative(comment.createdAt)}
          </span>
          {comment.editedAt && (
            <span className="text-xs text-muted-foreground" title={formatDateTime(comment.editedAt)}>
              • Edited
            </span>
          )}
        </div>
        {editing ? (
          <RichEditor initialHtml={comment.body} ariaLabel="Edit comment" autoFocus minHeight="min-h-20" media="thumb" onSave={save} onCancel={() => setEditing(false)} saving={busy} />
        ) : (
          <>
            <RichTextView html={comment.body} />
            {(onReply || comment.canEdit) && (
              <div className="mt-1 flex gap-2 text-xs font-semibold text-muted-foreground">
                {onReply && (
                  <button type="button" className="hover:text-foreground hover:underline" onClick={onReply}>
                    Reply
                  </button>
                )}
                {comment.canEdit && (
                  <>
                    {onReply && <span aria-hidden>•</span>}
                    <button type="button" className="hover:text-foreground hover:underline" onClick={() => setEditing(true)} disabled={busy}>Edit</button>
                    <span aria-hidden>•</span>
                    <button type="button" className="hover:text-foreground hover:underline" onClick={remove} disabled={busy}>Delete</button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
