"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Code, Link2, MoreHorizontal, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { WORK, withQuery } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WORK_ITEM_PRIORITIES, WORK_ITEM_STATUSES, WORK_ITEM_TYPES } from "../../contracts";
import type { WorkEpicRef, WorkUserRef } from "../../dto";
import {
  DEFAULT_EXPLORER,
  activeFilterCount,
  explorerQuery,
  type ExplorerFilters,
  type ExplorerGroup,
  type ExplorerQuick,
} from "../../explorer-logic";
import { filtersToJql } from "../../jql-logic";
import { STATUS_LABELS } from "../../transitions";
import { CARD_FIELD_LABELS, DEFAULT_CARD_FIELDS, setCardFields, useCardFields, type CardFields } from "../board/card-fields";
import { TypeIcon, epicTone } from "../item-bits";
import { PRIORITY_LABELS, TYPE_LABELS } from "../labels";
import { MultiFilter } from "./multi-filter";

const QUICK: { value: ExplorerQuick; label: string }[] = [
  { value: "mine", label: "Only my issues" },
  { value: "recent", label: "Recently updated" },
  { value: "overdue", label: "Overdue" },
  { value: "flagged", label: "Flagged" },
  { value: "requests", label: "Client requests" },
];

const GROUPS: { value: ExplorerGroup; label: string }[] = [
  { value: "none", label: "None" },
  { value: "epic", label: "Epic" },
  { value: "assignee", label: "Assignee" },
  { value: "priority", label: "Priority" },
  { value: "product", label: "Company" },
  { value: "client", label: "Client" },
];

/**
 * The board toolbar, laid out like Jira's: search, Assignee, Epic · Type ·
 * Label · Quick filters on the left; Group, View settings and ⋯ on the right
 * (plus `extra`, e.g. Complete sprint). The List view adds Status and
 * Priority. Every control writes the URL, so a view is a shareable link.
 * Shortcut: "/" focuses search.
 */
export function ExplorerToolbar({
  filters,
  clients,
  assignees,
  labels,
  epics = [],
  viewerId,
  base = WORK.all,
  lockProduct = false,
  extra,
}: {
  filters: ExplorerFilters;
  clients: { id: string; name: string }[];
  assignees: WorkUserRef[];
  labels: string[];
  epics?: WorkEpicRef[];
  viewerId: string;
  /** WORK.all, or a company board (WORK.board(slug)) whose route fixes the company. */
  base?: string;
  lockProduct?: boolean;
  /** Right-hand slot before Group (a sprints board's Complete sprint). */
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const [q, setQ] = useState(filters.q ?? "");
  const searchRef = useRef<HTMLInputElement>(null);
  const fields = useCardFields();
  // Jira's "Switch to JQL": the same filters (and sort) as a query on the search page.
  const toJql = () => {
    const slug = lockProduct ? base.split("/").pop() : undefined;
    const jql = filtersToJql(
      { ...filters, q, product: slug ? [slug] : filters.product },
      {
        boardKey: () => undefined,
        user: (id) => assignees.find((a) => a.id === id)?.name,
        epicKey: (id) => epics.find((e) => e.id === id)?.key,
        client: (id) => clients.find((c) => c.id === id)?.name,
      },
    );
    router.push(withQuery(WORK.search, { jql: jql || undefined }));
  };
  const push = (patch: Partial<ExplorerFilters>) =>
    start(() => router.replace(withQuery(base, explorerQuery({ ...filters, ...patch, ...(lockProduct ? { product: [] } : {}) })), { scroll: false }));
  // The company scope lives in the header breadcrumb, so it doesn't count as a filter here.
  const count = activeFilterCount({ ...filters, product: [] });
  const list = filters.view === "list";
  const clearAll = () => {
    setQ("");
    push({ ...DEFAULT_EXPLORER, product: filters.product, view: filters.view, group: filters.group, sort: filters.sort, dir: filters.dir, q: undefined });
  };

  // Debounced search-as-you-type.
  useEffect(() => {
    const next = q.trim();
    if (next === (filters.q ?? "")) return;
    const t = setTimeout(() => push({ q: next || undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || el?.closest("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // You first, then everyone else as the server ordered them.
  const people = [...assignees].sort((a, b) => (a.id === viewerId ? -1 : b.id === viewerId ? 1 : 0));

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2" data-pending={pending ? "" : undefined}>
      <div className="relative w-full sm:mr-1.5 sm:w-auto">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          className="h-9 w-full rounded-[3px] border-2 pl-8 shadow-none transition-[width] focus-visible:border-info focus-visible:ring-0 sm:w-52 sm:focus-visible:w-64"
          placeholder="Search board"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQ("")}
          aria-label="Search by title or key, e.g. FIXO-3 (press / to focus)"
          title="Title or key, e.g. FIXO-3 — press / to focus"
        />
      </div>

      {/* Phones: one swipeable row of filters instead of four wrapped rows; desktop keeps the wrapping toolbar. */}
      <div className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] sm:contents [&::-webkit-scrollbar]:hidden">
      <MultiFilter
        label="Assignee"
        options={[
          { value: "unassigned", label: "Unassigned" },
          ...people.map((a) => ({ value: a.id, label: a.name, person: true, hint: a.id === viewerId ? "you" : undefined })),
        ]}
        selected={filters.assignee}
        onChange={(assignee) => push({ assignee })}
      />

      {(
        <MultiFilter
          label="Epic"
          emptyText="No epics yet — create an Epic to group work"
          options={epics.length ? [...epics.map((e) => ({ value: e.id, label: e.title, hint: e.key, swatch: epicTone(e.id).dot })), { value: "none", label: "Issues without epic" }] : []}
          selected={filters.epic}
          onChange={(epic) => push({ epic })}
        />
      )}
      <MultiFilter
        label="Type"
        options={WORK_ITEM_TYPES.filter((t) => list || t !== "epic").map((t) => ({ value: t, label: TYPE_LABELS[t], icon: <TypeIcon type={t} /> }))}
        selected={filters.type}
        onChange={(type) => push({ type: type as ExplorerFilters["type"] })}
      />
      <MultiFilter label="Label" emptyText="No labels yet — add them on an issue" options={labels.map((l) => ({ value: l, label: l }))} selected={filters.label} onChange={(label) => push({ label })} />
      <MultiFilter label="Quick filters" options={QUICK.map((x) => ({ value: x.value, label: x.label }))} selected={filters.quick} onChange={(quick) => push({ quick: quick as ExplorerQuick[] })} />
      {clients.length > 0 && (
        <MultiFilter
          label="Client"
          options={[...clients.map((c) => ({ value: c.id, label: c.name })), { value: "none", label: "No client" }]}
          selected={filters.client}
          onChange={(client) => push({ client })}
        />
      )}
      {list && (
        <>
          <MultiFilter
            label="Status"
            options={WORK_ITEM_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            selected={filters.status}
            onChange={(status) => push({ status: status as ExplorerFilters["status"] })}
          />
          <MultiFilter
            label="Priority"
            options={WORK_ITEM_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
            selected={filters.priority}
            onChange={(priority) => push({ priority: priority as ExplorerFilters["priority"] })}
          />
        </>
      )}
      {count > 0 && (
        <Button variant="ghost" size="sm" className="h-9 shrink-0 gap-1 px-2 text-info hover:text-info" onClick={clearAll}>
          <X className="size-3.5" /> Clear filters
        </Button>
      )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {extra}
        <Button variant="ghost" size="sm" className="h-9 cursor-pointer rounded-[3px] border px-3 font-mono text-xs font-semibold" title="Switch to JQL — these filters as a query" onClick={toJql}>
          JQL
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-[3px] border"
          title="Refresh the board"
          aria-label="Refresh"
          disabled={refreshing}
          onClick={() => startRefresh(() => router.refresh())}
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
        </Button>
        {!list && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn("h-9 rounded-[3px] border px-3 font-medium", filters.group !== "none" && "border-info bg-info/10 text-info hover:bg-info/15 hover:text-info")}
              >
                Group: {GROUPS.find((g) => g.value === filters.group)?.label ?? "None"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Group by</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={filters.group} onValueChange={(v) => push({ group: v as ExplorerGroup })}>
                {GROUPS.filter((g) => !lockProduct || g.value !== "product").map((g) => (
                  <DropdownMenuRadioItem key={g.value} value={g.value}>
                    {g.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {!list && <ViewSettings fields={fields} />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-9 rounded-[3px] border" aria-label="More board options">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              onSelect={() =>
                void navigator.clipboard.writeText(window.location.href).then(
                  () => toast.success("Link to this view copied"),
                  () => toast.error("Couldn't copy the link"),
                )
              }
            >
              <Link2 className="size-4" /> Copy link to this view
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toJql}>
              <Code className="size-4" /> Switch to JQL
            </DropdownMenuItem>
            {count > 0 && (
              <DropdownMenuItem onSelect={clearAll}>
                <X className="size-4" /> Clear filters
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Jira's View settings (sliders): which fields the cards show. */
function ViewSettings({ fields }: { fields: CardFields }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9 rounded-[3px] border" aria-label="View settings" title="View settings">
          <SlidersHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Show on cards</DropdownMenuLabel>
        {(Object.keys(CARD_FIELD_LABELS) as (keyof CardFields)[]).map((k) => (
          <DropdownMenuCheckboxItem key={k} checked={fields[k]} onSelect={(e) => e.preventDefault()} onCheckedChange={(v) => setCardFields({ ...fields, [k]: v === true })}>
            {CARD_FIELD_LABELS[k]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setCardFields(DEFAULT_CARD_FIELDS)} className="text-xs text-muted-foreground">
          <Check className="size-3.5" /> Show everything
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
