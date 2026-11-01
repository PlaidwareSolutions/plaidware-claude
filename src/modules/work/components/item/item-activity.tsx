"use client";

import { useState } from "react";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import type { WorkCommentDto, WorkEventDto, WorkUserRef } from "../../dto";
import { describeWorkEvent, workEventLabel } from "../../event-kinds";
import { CommentComposer, CommentThread, PendingComment, usePendingComments } from "./comments-section";

type Tab = "all" | "comments" | "history";
const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "comments", label: "Comments" },
  { value: "history", label: "History" },
];

/** Jira's Activity block: Show All | Comments | History, newest history first, comments oldest first. */
export function ItemActivity({
  itemId,
  comments,
  events,
  viewer,
}: {
  itemId: string;
  comments: WorkCommentDto[];
  events: WorkEventDto[];
  viewer: WorkUserRef | null;
}) {
  const [tab, setTab] = useState<Tab>("comments");
  const [pending, addPending] = usePendingComments();

  // Threads: top-level comments (or replies whose parent is gone) with their replies, oldest first.
  const ids = new Set(comments.map((c) => c.id));
  const tops = comments.filter((c) => !c.parentId || !ids.has(c.parentId));
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id);
  const thread = (c: WorkCommentDto) => <CommentThread key={`c-${c.id}`} itemId={itemId} comment={c} replies={repliesOf(c.id)} />;

  const all = [
    ...tops.map((c) => ({ at: c.createdAt, node: thread(c) })),
    ...events.map((e) => ({ at: e.createdAt, node: <HistoryRow key={`e-${e.id}`} event={e} /> })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-foreground">Activity</h2>
      <div className="flex items-center gap-1 text-sm" role="tablist" aria-label="Activity">
        <span className="mr-1 text-muted-foreground">Show:</span>
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "rounded-[3px] px-2 py-1 font-medium",
              tab === t.value ? "bg-info/15 text-info" : "bg-muted text-foreground/80 hover:bg-accent",
            )}
          >
            {t.label}
            {t.value === "comments" && comments.length > 0 && <span className="ml-1 tabular-nums opacity-70">{comments.length}</span>}
          </button>
        ))}
      </div>

      {tab !== "history" && <CommentComposer itemId={itemId} viewer={viewer} onPosting={addPending} />}

      <ol className="flex flex-col gap-5">
        {tab !== "history" && pending.map((body, i) => <PendingComment key={`p-${i}`} body={body} viewer={viewer} />)}
        {tab === "comments" && tops.map(thread)}
        {tab === "history" && events.map((e) => <HistoryRow key={e.id} event={e} />)}
        {tab === "all" && all.map((x) => x.node)}
        {tab === "comments" && comments.length === 0 && pending.length === 0 && (
          <li className="text-sm text-muted-foreground">No comments yet. Decisions, questions and progress notes go here.</li>
        )}
        {tab === "history" && events.length === 0 && <li className="text-sm text-muted-foreground">No history yet.</li>}
      </ol>
    </section>
  );
}

function HistoryRow({ event }: { event: WorkEventDto }) {
  const detail = describeWorkEvent(event.kind, event.payload);
  const name = event.actor?.name ?? "System";
  return (
    <li className="flex gap-3 text-sm">
      <UserAvatar name={name} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-semibold text-foreground">{name}</span>
          <span className="text-foreground/80">{workEventLabel(event.kind).toLowerCase()}</span>
          <span className="text-xs text-muted-foreground" title={formatDateTime(event.createdAt)}>
            {formatRelative(event.createdAt)}
          </span>
        </div>
        {detail && <div className="mt-0.5 text-muted-foreground">{detail}</div>}
      </div>
    </li>
  );
}
