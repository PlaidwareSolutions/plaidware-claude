"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, Clock, Gauge, Radio, Search } from "lucide-react";
import type { MonitoringBoard } from "../queries";
import { IncidentsView } from "./incidents-view";
import { SeoControls } from "@/modules/seo/components/seo-controls";
import { formatDateTime, formatRelative, formatUtcHour } from "@/lib/dates";
import { OPS, withQuery } from "@/lib/routes";
import { Section } from "@/components/section";
import { StatTile } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
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

const STATUS_OPTIONS = [
  { value: "all", label: "All sites" },
  { value: "problem", label: "Problems (down, degraded, quiet)" },
  { value: "healthy", label: "Healthy" },
  { value: "no_data", label: "Never probed" },
];

export function OpsMonitoringBoard({ board }: { board: MonitoringBoard }) {
  const router = useRouter();
  const f = board.filter;
  const push = (patch: Partial<typeof f>) =>
    router.push(withQuery(OPS.monitoring, { product: f.product, tenant: f.tenant, status: f.status, q: f.q, ...patch }));
  const filtered = Boolean(f.product || f.tenant || f.status || f.q);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Monitored sites" value={board.stats.monitored} sub="live subscriptions with a domain" />
        <StatTile label="Open incidents" value={board.stats.incidents} tone={board.stats.incidents ? "danger" : "success"} />
        <StatTile label="Quiet reporters" value={board.stats.quiet} tone={board.stats.quiet ? "warning" : "default"} />
        <StatTile
          label="Fleet uptime 30d"
          value={board.stats.fleetUptimePct != null ? `${board.stats.fleetUptimePct}%` : "—"}
          tone={board.stats.fleetUptimePct == null ? "default" : board.stats.fleetUptimePct >= 99.5 ? "success" : board.stats.fleetUptimePct >= 98 ? "warning" : "danger"}
        />
        <StatTile label="SEO alerts" value={board.stats.seoAlerts} tone={board.stats.seoAlerts ? "warning" : "default"} sub="unsnoozed regressions" />
        <StatTile label="Ingest errors 7d" value={board.stats.ingestErrors} tone={board.stats.ingestErrors ? "warning" : "default"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 w-64 pl-8"
            placeholder="Client or product…"
            defaultValue={f.q ?? ""}
            onKeyDown={(e) => {
              if (e.key === "Enter") push({ q: (e.target as HTMLInputElement).value || undefined });
            }}
          />
        </div>
        <Select value={f.product ?? "all"} onValueChange={(v) => push({ product: v === "all" ? undefined : v })}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All products</SelectItem>
            {board.options.products.map((p) => <SelectItem key={p.slug} value={p.slug}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={f.tenant ?? "all"} onValueChange={(v) => push({ tenant: v === "all" ? undefined : v })}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {board.options.tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={f.status ?? "all"} onValueChange={(v) => push({ status: v === "all" ? undefined : v })}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => router.push(OPS.monitoring)}>Clear filters</Button>
        )}
      </div>

      <IncidentsView incidents={board.incidents} quiet={board.quiet} />

      <Section title="Fleet uptime" icon={Activity} count={board.fleet.length} description="Every live subscription, worst first.">
        <DataTableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead>Latest</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Uptime 30d</TableHead>
                <TableHead className="hidden text-right md:table-cell">Avg response</TableHead>
                <TableHead className="hidden lg:table-cell">Reporter</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.fleet.length === 0 && (
                <TableEmpty colSpan={5} icon={Activity} title={filtered ? "No sites match" : "No live subscriptions"} />
              )}
              {board.fleet.map((r) => (
                <TableRow key={r.subscriptionId}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-x-2 text-sm">
                      <Link href={OPS.clientTab(r.tenantId, "monitoring")} className="font-medium text-heading hover:text-primary">{r.tenantName}</Link>
                      <span className="text-muted-foreground">·</span>
                      <Link href={OPS.product(r.productId)} className="hover:text-primary">{r.productName}</Link>
                      {r.status !== "active" && <StatusBadge kind="subscription" status={r.status} className="text-[10px]" />}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{r.domainUrl ?? "no domain — not probed"}</div>
                  </TableCell>
                  <TableCell>
                    {r.latest ? (
                      <div className="flex flex-col gap-0.5">
                        <StatusBadge kind="health" status={r.latest.status} />
                        <span className="text-[11px] text-muted-foreground" title={formatDateTime(r.latest.at)}>
                          {r.latest.source} · {formatRelative(r.latest.at)}
                        </span>
                      </div>
                    ) : (
                      <StatusBadge kind="health" status={null} />
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {r.uptime?.uptimePct != null ? (
                      <span className={r.uptime.uptimePct >= 99.5 ? "text-success" : r.uptime.uptimePct >= 98 ? "text-warning" : "text-destructive"}>{r.uptime.uptimePct}%</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {r.uptime && <div className="text-[11px] text-muted-foreground">{r.uptime.probes} probes</div>}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {r.uptime?.avgResponseMs != null ? `${r.uptime.avgResponseMs}ms` : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {r.quiet ? (
                      <Badge variant="warning" className="text-[10px]">quiet</Badge>
                    ) : r.ingest ? (
                      <span className="text-xs text-muted-foreground">{r.ingest.calls} calls 7d{r.ingest.errors ? ` · ${r.ingest.errors} errors` : ""}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">no reporter</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableShell>
      </Section>

      <Section title="SEO & Core Web Vitals" icon={Gauge} count={board.seo.length} description="Company Website subscriptions with a live domain; regressions first.">
        <DataTableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead className="text-right">Mobile</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Desktop</TableHead>
                <TableHead className="hidden md:table-cell">Alerts</TableHead>
                <TableHead className="hidden lg:table-cell">Last audit</TableHead>
                <TableHead className="w-56" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.seo.length === 0 && (
                <TableEmpty colSpan={6} icon={Gauge} title="Nothing audited" description="PageSpeed audits need a Company Website subscription with a live domain and PAGESPEED_INSIGHTS_API_KEY." />
              )}
              {board.seo.map((r) => {
                const score = (s: { performance: number | null; seo: number | null; ok: boolean } | null) =>
                  !s ? <span className="text-muted-foreground">—</span> : !s.ok ? <Badge variant="destructive" className="text-[10px]">audit failed</Badge> : (
                    <span className={`tabular-nums ${s.performance == null ? "" : s.performance < 50 ? "text-destructive" : s.performance < 90 ? "text-warning" : "text-success"}`}>
                      {s.performance ?? "—"}<span className="text-xs text-muted-foreground"> / {s.seo ?? "—"} seo</span>
                    </span>
                  );
                return (
                  <TableRow key={r.subscriptionId}>
                    <TableCell>
                      <Link href={OPS.clientTab(r.tenantId, "monitoring")} className="font-medium text-heading hover:text-primary">{r.tenantName}</Link>
                      <div className="truncate text-xs text-muted-foreground">{r.domainUrl}</div>
                    </TableCell>
                    <TableCell className="text-right">{score(r.scores.mobile)}</TableCell>
                    <TableCell className="hidden text-right sm:table-cell">{score(r.scores.desktop)}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {r.alerts.length === 0 ? (
                        <span className="text-xs text-muted-foreground">none</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.alerts.slice(0, 3).map((a, i) => (
                            <Badge key={i} variant={r.snoozedUntil ? "outline" : "warning"} className="text-[10px]">
                              {a.category} {a.current}{a.baseline != null ? ` (was ${a.baseline})` : ""}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{r.lastAuditAt ? formatRelative(r.lastAuditAt) : "—"}</TableCell>
                    <TableCell>
                      <SeoControls subscriptionId={r.subscriptionId} strategy="mobile" snoozedUntil={r.snoozedUntil} compact />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DataTableShell>
      </Section>

      <Section title="Ingest health (7 days)" icon={Radio} count={board.ingest.length} description="Reporter calls per subscription; unknown keys point at a product's KPI contract.">
        {board.ingest.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reporter has posted metrics in the last 7 days.</p>
        ) : (
          <DataTableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subscription</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="hidden md:table-cell">Unknown keys</TableHead>
                  <TableHead className="hidden lg:table-cell">Last call</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {board.ingest.map((r) => (
                  <TableRow key={r.subscriptionId}>
                    <TableCell>
                      <Link href={OPS.clientTab(r.tenantId, "monitoring")} className="font-medium text-heading hover:text-primary">{r.tenantName}</Link>
                      <span className="text-muted-foreground"> · </span>
                      <Link href={OPS.product(r.productId)} className="hover:text-primary">{r.productName}</Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.calls}</TableCell>
                    <TableCell className={`text-right tabular-nums ${r.errors ? "text-destructive" : ""}`}>
                      {r.errors}
                      {r.lastError && <div className="max-w-56 truncate text-[11px] font-normal text-muted-foreground" title={r.lastError}>{r.lastError}</div>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {r.unknownKeys.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Link href={OPS.productTab(r.productId, "kpis")} className="flex flex-wrap gap-1 hover:opacity-80" title="Define these on the product's KPIs tab">
                          {r.unknownKeys.map((k) => <Badge key={k} variant="warning" className="font-mono text-[10px]">{k}</Badge>)}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{r.lastAt ? formatRelative(r.lastAt) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTableShell>
        )}
      </Section>

      <Section title="Worker schedule" icon={Clock} description="What runs on its own, and when.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {board.schedule.map((s) => (
            <div key={s.queue} className="rounded-lg border bg-card px-4 py-3 text-sm">
              <div className="font-medium text-heading">{s.label}</div>
              <div className="text-xs text-muted-foreground">
                {s.cadence} · next {formatUtcHour(s.nextAt)}
                {s.lastAt ? ` · last observed ${formatRelative(s.lastAt)}` : ""}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">{s.queue}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
