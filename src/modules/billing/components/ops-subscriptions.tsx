"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Receipt } from "lucide-react";
import type { OpsSubscriptionDto } from "../queries";
import { MRR_STATUSES } from "../mappers";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { downloadCsv, toCsv } from "@/lib/csv";
import { OPS } from "@/lib/routes";
import { StatusBadge } from "@/components/status-badge";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type SortKey = "tenant" | "product" | "status" | "monthly" | "oneTime" | "periodEnd" | "since";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const CLOSED = new Set(["canceled", "expired"]);

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "live", label: "Live (not closed)" },
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "trialing", label: "Trialing" },
  { value: "past_due", label: "Past due" },
  { value: "suspended", label: "Suspended" },
  { value: "incomplete", label: "Incomplete" },
  { value: "canceled", label: "Canceled" },
  { value: "expired", label: "Expired" },
];

function compare(a: OpsSubscriptionDto, b: OpsSubscriptionDto, key: SortKey): number {
  switch (key) {
    case "tenant":
      return a.tenantName.localeCompare(b.tenantName);
    case "product":
      return a.productName.localeCompare(b.productName);
    case "status":
      return a.status.localeCompare(b.status);
    case "monthly":
      return a.monthlyCents - b.monthlyCents;
    case "oneTime":
      return a.oneTimeCents - b.oneTimeCents;
    case "periodEnd":
      return (a.currentPeriodEnd ?? "9999").localeCompare(b.currentPeriodEnd ?? "9999");
    case "since":
      return a.subscribedAt.localeCompare(b.subscribedAt);
  }
}

export function OpsSubscriptions({
  rows,
  initialQuery = "",
  initialStatus = "live",
  initialProduct = "all",
}: {
  rows: OpsSubscriptionDto[];
  /** Seeded from ?q= / ?status= / ?product= so other pages can deep-link a filtered view. */
  initialQuery?: string;
  initialStatus?: string;
  initialProduct?: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [status, setStatus] = useState(
    STATUS_FILTERS.some((f) => f.value === initialStatus) ? initialStatus : "live",
  );
  const [product, setProduct] = useState(initialProduct);
  const [sort, setSort] = useState<Sort>({ key: "monthly", dir: "desc" });

  const productOptions = (() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.productSlug, r.productName);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  })();

  const needle = q.trim().toLowerCase();
  const filtered = rows
    .filter((r) => {
      if (status === "live" ? CLOSED.has(r.status) : status !== "all" && r.status !== status) return false;
      if (product !== "all" && r.productSlug !== product) return false;
      if (
        needle &&
        !`${r.tenantName} ${r.tenantSlug} ${r.productName}`.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const c = compare(a, b, sort.key) || a.tenantName.localeCompare(b.tenantName);
      return sort.dir === "asc" ? c : -c;
    });

  const mrrCents = filtered
    .filter((r) => (MRR_STATUSES as string[]).includes(r.status))
    .reduce((s, r) => s + r.monthlyCents, 0);
  const tenantCount = new Set(filtered.map((r) => r.tenantId)).size;

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "monthly" || key === "oneTime" ? "desc" : "asc" },
    );
  }

  function exportCsv() {
    const header = [
      "Client", "Client slug", "Product", "Product slug", "Status",
      "Monthly (USD)", "One-time (USD)", "Add-ons", "Period end", "Subscribed", "Canceled",
    ];
    const body = filtered.map((r) => [
      r.tenantName, r.tenantSlug, r.productName, r.productSlug, r.status,
      (r.monthlyCents / 100).toFixed(2), (r.oneTimeCents / 100).toFixed(2),
      r.addons.join("; "), r.currentPeriodEnd?.slice(0, 10) ?? "",
      r.subscribedAt.slice(0, 10), r.canceledAt?.slice(0, 10) ?? "",
    ]);
    downloadCsv(`subscriptions-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(header, body));
  }

  const head = (label: string, key: SortKey, className?: string) => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <TableHead className={className}>
        <button
          type="button"
          onClick={() => toggleSort(key)}
          className="inline-flex items-center gap-1 hover:text-heading"
        >
          {label}
          <Icon className={`size-3 ${active ? "" : "opacity-40"}`} />
        </button>
      </TableHead>
    );
  };

  const toolbar = (
    <>
      <Input
        className="h-9 w-64"
        placeholder="Search client or product…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          {STATUS_FILTERS.map((s) => (
            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={product} onValueChange={setProduct}>
        <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All products</SelectItem>
          {productOptions.map(([slug, name]) => (
            <SelectItem key={slug} value={slug}>{name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="ml-auto text-sm text-muted-foreground">
        {filtered.length} subscription{filtered.length === 1 ? "" : "s"} · {tenantCount} client
        {tenantCount === 1 ? "" : "s"} · MRR{" "}
        <span className="font-medium tabular-nums text-heading">{formatCents(mrrCents)}</span>
      </p>
      <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv} disabled={filtered.length === 0}>
        <Download className="size-4" /> Export CSV
      </Button>
    </>
  );

  return (
    <DataTableShell toolbar={toolbar}>
      <Table>
        <TableHeader>
          <TableRow>
            {head("Client", "tenant")}
            {head("Product", "product")}
            {head("Status", "status")}
            {head("Monthly", "monthly", "text-right")}
            {head("One-time", "oneTime", "hidden text-right md:table-cell")}
            <TableHead className="hidden lg:table-cell">Add-ons</TableHead>
            {head("Period end", "periodEnd", "hidden md:table-cell")}
            {head("Since", "since", "hidden xl:table-cell")}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && (
            <TableEmpty
              colSpan={8}
              icon={Receipt}
              title={rows.length === 0 ? "No subscriptions yet" : "No subscriptions match"}
              description={rows.length === 0 ? undefined : "Try another status, product, or search."}
            />
          )}
          {filtered.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Link href={OPS.client(r.tenantId)} className="font-medium text-heading hover:text-primary">
                  {r.tenantName}
                </Link>
                <div className="text-xs text-muted-foreground">{r.tenantSlug}</div>
              </TableCell>
              <TableCell>
                <Link href={OPS.product(r.productId)} className="hover:text-primary">{r.productName}</Link>
              </TableCell>
              <TableCell>
                <StatusBadge kind="subscription" status={r.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.monthlyCents > 0 ? `${formatCents(r.monthlyCents)}/mo` : "—"}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">
                {r.oneTimeCents > 0 ? formatCents(r.oneTimeCents) : "—"}
              </TableCell>
              <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                {r.addons.length ? r.addons.join(", ") : "—"}
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                {formatDate(r.currentPeriodEnd)}
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                {formatDate(r.subscribedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataTableShell>
  );
}
