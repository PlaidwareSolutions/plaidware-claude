"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { withQuery } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WORK_ITEM_PRIORITIES, WORK_ITEM_TYPES, type BoardFilters as Filters } from "../../contracts";
import type { WorkUserRef } from "../../dto";
import { PRIORITY_LABELS, TYPE_LABELS } from "../labels";

const ALL = "__all";

/** URL-driven filters for the board and backlog; sets data-pending while the new server render loads. */
export function BoardFilters({
  base,
  filters,
  assignees,
  labels,
}: {
  /** WORK.board(slug) or WORK.backlog(slug) */
  base: string;
  filters: Filters;
  assignees: WorkUserRef[];
  labels: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(filters.q ?? "");
  const push = (patch: Partial<Filters>) =>
    start(() => router.push(withQuery(base, { q: filters.q, type: filters.type, priority: filters.priority, assignee: filters.assignee, label: filters.label, ...patch })));
  const filtered = Boolean(filters.q || filters.type || filters.priority || filters.assignee || filters.label);
  const pick = (v: string) => (v === ALL ? undefined : v);

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      data-pending={pending ? "" : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        push({ q: q.trim() || undefined });
      }}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-8 w-52 pl-8" placeholder="Title or number…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
      </div>
      <Select value={filters.assignee ?? ALL} onValueChange={(v) => push({ assignee: pick(v) })}>
        <SelectTrigger size="sm" className="w-36" aria-label="Assignee"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Anyone</SelectItem>
          <SelectItem value="me">Me</SelectItem>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {assignees.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filters.type ?? ALL} onValueChange={(v) => push({ type: pick(v) as Filters["type"] })}>
        <SelectTrigger size="sm" className="w-36" aria-label="Type"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All types</SelectItem>
          {WORK_ITEM_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filters.priority ?? ALL} onValueChange={(v) => push({ priority: pick(v) as Filters["priority"] })}>
        <SelectTrigger size="sm" className="w-36" aria-label="Priority"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All priorities</SelectItem>
          {WORK_ITEM_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>)}
        </SelectContent>
      </Select>
      {labels.length > 0 && (
        <Select value={filters.label ?? ALL} onValueChange={(v) => push({ label: pick(v) })}>
          <SelectTrigger size="sm" className="w-36" aria-label="Label"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All labels</SelectItem>
            {labels.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {filtered && (
        <Button type="button" variant="ghost" size="sm" onClick={() => { setQ(""); start(() => router.push(base)); }}>
          Clear filters
        </Button>
      )}
    </form>
  );
}
