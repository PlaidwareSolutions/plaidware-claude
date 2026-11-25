"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useAction } from "@/lib/use-action";
import { StatusBadge } from "@/components/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quickCreateItemAction } from "../../actions";
import type { WorkCardDto } from "../../dto";
import { STATUS_LABELS } from "../../transitions";
import { PriorityIcon, TypeIcon } from "../item-bits";
import { usePeekHref } from "../peek-link";

/** An epic's child issues (Jira's "Child issues" panel): progress, the list, and + Add child issue. */
export function ChildIssues({ epicId, slug, items }: { epicId: string; slug: string; items: WorkCardDto[] }) {
  const peek = usePeekHref();
  const { run, isPending } = useAction();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const done = items.filter((c) => c.status === "done").length;
  const open = items.filter((c) => c.status !== "canceled").length;
  const pct = open ? Math.round((done / open) * 100) : 0;

  async function add() {
    const t = title.trim();
    if (!t) return;
    const res = await run(() => quickCreateItemAction({ productSlug: slug, title: t, status: "todo", parentId: epicId }), {
      key: "child",
      refresh: false,
      success: (r) => `${r.key} added to the epic`,
    });
    if (res?.ok) setTitle("");
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-foreground">Child issues</h2>
        {open > 0 && (
          <span className="flex flex-1 items-center gap-2 text-xs text-muted-foreground">
            <span className="h-2 max-w-48 flex-1 overflow-hidden rounded-full bg-muted" title={`${done} of ${open} done`}>
              <span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
            </span>
            {pct}% done
          </span>
        )}
        <Button variant="ghost" size="icon" className="ml-auto size-8 rounded-[3px]" aria-label="Add child issue" title="Add child issue" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
        </Button>
      </div>
      {items.length > 0 && (
        <ul className="divide-y rounded-[3px] border">
          {items.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50">
              <TypeIcon type={c.type} />
              <Link href={peek.open(slug, c.number)} scroll={false} className="shrink-0 text-xs font-semibold text-muted-foreground hover:text-info hover:underline">
                {c.key}
              </Link>
              <Link href={peek.open(slug, c.number)} scroll={false} className="min-w-0 flex-1 truncate text-foreground hover:underline">
                {c.title}
              </Link>
              <PriorityIcon priority={c.priority} />
              {c.assignee && <UserAvatar name={c.assignee.name} size="sm" />}
              <StatusBadge kind="workItem" status={c.status} label={STATUS_LABELS[c.status]} lozenge className="shrink-0" />
            </li>
          ))}
        </ul>
      )}
      {items.length === 0 && !adding && <p className="text-sm text-muted-foreground">No child issues yet. Add work that belongs to this epic.</p>}
      {adding && (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={title}
            disabled={isPending("child")}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="What needs to be done?"
            className="h-9 rounded-[3px] border-2 focus-visible:border-info focus-visible:ring-0"
            aria-label="New child issue"
          />
          <Button size="sm" className="h-9 rounded-[3px] bg-info text-white hover:bg-info/90 dark:text-background" disabled={!title.trim() || isPending("child")} onClick={() => void add()}>
            Create
          </Button>
          <Button size="sm" variant="ghost" className="h-9 rounded-[3px]" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      )}
    </section>
  );
}
