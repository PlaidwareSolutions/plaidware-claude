"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Receipt } from "lucide-react";
import type { OpsSubscriptionDto } from "../queries";
import { MRR_STATUSES } from "../mappers";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
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

function statusVariant(status: string): "secondary" | "outline" | "destructive" {
  if (status === "active") return "secondary";
  if (status === "trialing" || status === "incomplete") return "outline";
  return "destructive";
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

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

export function OpsSubscriptions({ rows }: { rows: OpsSubscriptionDto[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("live");
  const [product, setProduct] = useState("all");
  const [sort, setSort] = useState<Sort>({ key: "monthly", dir: "desc" });

  const productOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.productSlug, r.productName);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (status === "live" ? CLOSED.has(r.status) : status !== "all" && r.status !== status) return false;
      if (product !== "all" && r.productSlug !== product) return false;
      if (
        needle &&
        !`${r.tenantName} ${r.tenantSlug} ${r.productName}`.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    });
    out.sort((a, b) => {
      const c = compare(a, b, sort.key) || a.tenantName.localeCompare(b.tenantName);
      return sort.dir === "asc" ? c : -c;
    });
    return out;
  }, [rows, q, status, product, sort]);

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
      "Tenant", "Tenant slug", "Product", "Product slug", "Status",
      "Monthly (USD)", "One-time (USD)", "Add-ons", "Period end", "Subscribed", "Canceled",
    ];
    const lines = filtered.map((r) =>
      [
        r.tenantName, r.tenantSlug, r.productName, r.productSlug, r.status,
        (r.monthlyCents / 100).toFixed(2), (r.oneTimeCents / 100).toFixed(2),
        r.addons.join("; "), r.currentPeriodEnd?.slice(0, 10) ?? "",
        r.subscribedAt.slice(0, 10), r.canceledAt?.slice(0, 10) ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `subscriptions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-heading">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">
            Every subscription across every tenant — who pays for what, and how much.
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download className="size-4" /> Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-9 w-64"
          placeholder="Search tenant or product…"
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
          {filtered.length} subscription{filtered.length === 1 ? "" : "s"} · {tenantCount} tenant
          {tenantCount === 1 ? "" : "s"} · MRR{" "}
          <span className="font-medium tabular-nums text-heading">{formatCents(mrrCents)}</span>
        </p>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {head("Tenant", "tenant")}
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
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  <Receipt className="mx-auto mb-2 size-8 opacity-40" />
                  No subscriptions match.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/ops/tenants/${r.tenantId}`} className="font-medium text-heading hover:text-primary">
                    {r.tenantName}
                  </Link>
                  <div className="text-xs text-muted-foreground">{r.tenantSlug}</div>
                </TableCell>
                <TableCell>{r.productName}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(r.status)}>{r.status.replace("_", " ")}</Badge>
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
                  {fmtDate(r.currentPeriodEnd)}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                  {fmtDate(r.subscribedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
