"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Building2 } from "lucide-react";
import { WORK, withQuery } from "@/lib/routes";
import { formatDay, formatRelative, isoDay } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { assignItemAction, updateItemAction } from "../../actions";
import { useWorkTransitions } from "../transition-host";
import type { WorkUserRef } from "../../dto";
import { explorerQuery, isOverdue, sortCards, type ExplorerCard, type ExplorerFilters, type ExplorerSort } from "../../explorer-logic";
import { TypeIcon } from "../item-bits";
import { usePeekHref } from "../peek-link";
import { AssigneeSelect, PrioritySelect } from "../pickers";
import { StatusButton } from "../item/status-button";

/** The issue list: every match in one sortable table; status, assignee and priority edit in place. */
export function ExplorerList({
  cards,
  filters,
  assignees,
  productOrder,
  base = WORK.all,
}: {
  cards: ExplorerCard[];
  filters: ExplorerFilters;
  assignees: WorkUserRef[];
  productOrder: string[];
  base?: string;
}) {
  const peek = usePeekHref();
  const { run, isPending } = useAction();
  const transitions = useWorkTransitions();
  const rows = sortCards(cards, filters.sort, filters.dir, productOrder);
  const today = isoDay();
  const save = (key: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => void run(fn, { key, refresh: false });


  return (
    <DataTableShell className="transition-opacity group-has-data-pending:opacity-50">
      <Table>
        <TableHeader>
          <TableRow>
            <SortHead base={base} filters={filters} by="key" className="w-28">Key</SortHead>
            <TableHead>Summary</TableHead>
            <SortHead base={base} filters={filters} by="status" className="w-36">Status</SortHead>
            <TableHead className="hidden w-44 md:table-cell">Assignee</TableHead>
            <SortHead base={base} filters={filters} by="priority" className="hidden w-32 sm:table-cell">Priority</SortHead>
            <TableHead className="hidden lg:table-cell">Client</TableHead>
            <SortHead base={base} filters={filters} by="due" className="hidden md:table-cell">Due</SortHead>
            <SortHead base={base} filters={filters} by="updated" className="hidden lg:table-cell">Updated</SortHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && <TableEmpty colSpan={8} title="No items match these filters" description="Clear a filter or widen the status to see more." />}
          {rows.map((c) => {
            const href = peek.open(c.product.slug, c.number);
            const overdue = isOverdue(c, today);
            return (
              <TableRow key={c.id}>
                <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <TypeIcon type={c.type} />
                    <span className="size-2 rounded-full" style={{ background: c.product.color ?? "var(--primary)" }} title={c.product.name} />
                    <Link href={href} scroll={false} className="hover:text-primary">{c.key}</Link>
                  </span>
                </TableCell>
                <TableCell className="max-w-md">
                  <Link href={href} scroll={false} className="line-clamp-1 font-medium text-heading hover:text-primary">{c.title}</Link>
                  {c.labels.length > 0 && <span className="text-[11px] text-muted-foreground">{c.labels.join(" · ")}</span>}
                </TableCell>
                <TableCell>
                  <StatusButton size="sm" status={c.status} onChange={(v) => void transitions.move({ id: c.id, key: c.key, type: c.type, status: c.status, title: c.title }, v)} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <AssigneeSelect value={c.assignee?.id ?? null} assignees={assignees} disabled={isPending(`a:${c.id}`)} className="h-7 w-40 text-xs" onChange={(v) => save(`a:${c.id}`, () => assignItemAction({ itemId: c.id, assigneeUserId: v }))} />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <PrioritySelect value={c.priority} disabled={isPending(`p:${c.id}`)} className="h-7 w-28 text-xs" onChange={(v) => save(`p:${c.id}`, () => updateItemAction({ itemId: c.id, patch: { priority: v } }))} />
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                  {c.requester ? (
                    <span className="inline-flex items-center gap-1"><Building2 className="size-3" /> {c.requester.tenantName}</span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className={cn("hidden whitespace-nowrap text-sm md:table-cell", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                  {c.dueOn ? formatDay(c.dueOn) : "—"}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground lg:table-cell">{formatRelative(c.updatedAt)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DataTableShell>
  );
}

function SortHead({ base, by, filters, children, className }: { base: string; by: ExplorerSort; filters: ExplorerFilters; children: React.ReactNode; className?: string }) {
  const on = filters.sort === by;
  const Icon = !on ? ArrowUpDown : filters.dir === "asc" ? ArrowUp : ArrowDown;
  const href = withQuery(base, explorerQuery({ ...filters, ...(base === WORK.all ? {} : { product: [] }), sort: by, dir: on && filters.dir === "asc" ? "desc" : "asc" }));
  return (
    <TableHead className={className} aria-sort={on ? (filters.dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={href} scroll={false} replace className={cn("inline-flex items-center gap-1 hover:text-heading", on && "text-heading")}>
        {children}
        <Icon className={cn("size-3", !on && "opacity-40")} />
      </Link>
    </TableHead>
  );
}
