"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, RefreshCw, Server, Users } from "lucide-react";
import type { HostedAppRow, ProductMargin, TenantCostRow } from "../service";
import {
  registerHostedAppAction,
  setAppSubscriptionLinkAction,
  syncRailwayNowAction,
  toggleAppProductLinkAction,
  upsertManualCostAction,
} from "../actions";
import { formatCents } from "@/lib/money";
import { formatMonth } from "@/lib/dates";
import { OPS, withQuery } from "@/lib/routes";
import { useAction } from "@/lib/use-action";
import { Section } from "@/components/section";
import { StatTile } from "@/components/stat-tile";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type Option = { id: string; name: string };
type SubOption = { id: string; tenantId: string; tenantName: string; productId: string; productName: string };

const marginTone = (pct: number | null) =>
  pct == null ? "" : pct >= 70 ? "text-success" : pct >= 40 ? "text-warning" : "text-destructive";

export function CostsView({
  month,
  months,
  totals,
  apps,
  margins,
  byTenant,
  products,
  subscriptions,
  railwayConfigured,
}: {
  month: string;
  /** Month keys offered by the picker (current first). */
  months: string[];
  totals: { costCents: number | null; revenueCents: number };
  apps: HostedAppRow[];
  margins: ProductMargin[];
  byTenant: TenantCostRow[];
  products: Option[];
  subscriptions: SubOption[];
  railwayConfigured: boolean;
}) {
  const router = useRouter();
  const { run, isPending } = useAction();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ provider: "railway", externalRef: "", label: "", productId: "none" });
  const [linkFor, setLinkFor] = useState<HostedAppRow | null>(null);
  const [manualFor, setManualFor] = useState<HostedAppRow | null>(null);
  const [manualAmount, setManualAmount] = useState("");
  const [dedicate, setDedicate] = useState<string>("none");

  const marginPct =
    totals.costCents != null && totals.revenueCents > 0
      ? Math.round(((totals.revenueCents - totals.costCents) / totals.revenueCents) * 100)
      : null;

  async function add() {
    const res = await run(
      () =>
        registerHostedAppAction({
          provider: form.provider as "railway" | "other",
          externalRef: form.externalRef,
          label: form.label,
          productId: form.productId === "none" ? null : form.productId,
        }),
      { key: "add", success: "App registered" },
    );
    if (res?.ok) {
      setAddOpen(false);
      setForm({ provider: "railway", externalRef: "", label: "", productId: "none" });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={month} onValueChange={(v) => router.push(withQuery(OPS.costs, { month: v === months[0] ? undefined : v }))}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {months.map((m) => <SelectItem key={m} value={m}>{formatMonth(m)}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {railwayConfigured ? "Synced daily from Railway; manual entries override." : "RAILWAY_API_TOKEN not set — enter costs manually."}
        </span>
        <div className="ml-auto flex gap-2">
          {railwayConfigured && (
            <Button
              variant="outline"
              className="gap-1"
              disabled={isPending("sync")}
              onClick={() =>
                void run(() => syncRailwayNowAction(), {
                  key: "sync",
                  success: (r) => `Synced ${r.apps} apps — ${formatCents(r.totalCents)} month-to-date`,
                })
              }
            >
              <RefreshCw className="size-4" /> {isPending("sync") ? "Syncing…" : "Sync Railway now"}
            </Button>
          )}
          <Button className="gap-1" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Register app
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label={`Hosting cost · ${formatMonth(month)}`} value={totals.costCents != null ? formatCents(totals.costCents) : "—"} sub={`${apps.length} hosted app${apps.length === 1 ? "" : "s"}`} />
        <StatTile label="Revenue (paid invoices)" value={formatCents(totals.revenueCents)} />
        <StatTile label="Gross margin" value={marginPct != null ? `${marginPct}%` : "—"} tone={marginPct == null ? "default" : marginPct >= 70 ? "success" : marginPct >= 40 ? "warning" : "danger"} sub={totals.costCents == null ? "no cost data yet" : undefined} />
      </div>

      <Section title="Margin by product" description={formatMonth(month)}>
        <DataTableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Hosting cost</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {margins.length === 0 && <TableEmpty colSpan={4} title="No active products" />}
              {margins.map((m) => (
                <TableRow key={m.productId}>
                  <TableCell>
                    <Link href={OPS.product(m.productId)} className="font-medium text-heading hover:text-primary">{m.productName}</Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(m.revenueCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.costCents != null ? formatCents(m.costCents) : "—"}</TableCell>
                  <TableCell className={`text-right tabular-nums ${marginTone(m.marginPct)}`}>{m.marginPct != null ? `${m.marginPct}%` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableShell>
      </Section>

      <Section title="By client" icon={Users} count={byTenant.length} description="Dedicated apps land on their client; shared apps split across live subscribers.">
        <DataTableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="hidden md:table-cell">Attributed apps</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byTenant.length === 0 && <TableEmpty colSpan={5} icon={Users} title="Nothing to attribute" description="Link hosted apps to products or dedicate them to subscriptions." />}
              {byTenant.map((t) => (
                <TableRow key={t.tenantId}>
                  <TableCell>
                    <Link href={OPS.client(t.tenantId)} className="font-medium text-heading hover:text-primary">{t.tenantName}</Link>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {t.apps.length === 0 ? "—" : t.apps.map((a) => `${a.label} (${a.basis === "dedicated" ? "dedicated" : `${Math.round(a.share * 100)}%`})`).join(", ")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(t.revenueCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(t.costCents)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${marginTone(t.marginPct)}`}>{t.marginPct != null ? `${t.marginPct}%` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableShell>
      </Section>

      <Section title="Hosted apps" icon={Server} count={apps.length}>
        <DataTableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App</TableHead>
                <TableHead className="hidden md:table-cell">Attribution</TableHead>
                <TableHead className="text-right">Cost ({formatMonth(month)})</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.length === 0 && (
                <TableEmpty colSpan={4} icon={Server} title="No hosted apps registered" description="Register your Railway services to start attributing cost to products and clients." />
              )}
              {apps.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium text-heading">{a.label}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{a.provider} · {a.externalRef}</div>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {a.dedicated ? (
                      <span className="text-xs">
                        <Badge variant="secondary" className="mr-1 text-[10px]">dedicated</Badge>
                        <Link href={OPS.client(a.dedicated.tenantId)} className="text-heading hover:text-primary">{a.dedicated.tenantName}</Link>
                        <span className="text-muted-foreground"> · {a.dedicated.productName}</span>
                      </span>
                    ) : a.products.length === 0 ? (
                      <Badge variant="warning" className="text-[10px]">unattributed</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        shared by{" "}
                        {a.products.map((p, i) => (
                          <span key={p.id}>
                            {i > 0 && ", "}
                            <Link href={OPS.product(p.id)} className="hover:text-primary">{p.name}</Link>
                          </span>
                        ))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {a.costCents != null ? formatCents(a.costCents) : "—"}
                    {a.costSource && <Badge variant="outline" className="ml-1 text-[9px]">{a.costSource === "manual" ? "manual" : "api"}</Badge>}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => { setLinkFor(a); setDedicate(a.dedicated?.subscriptionId ?? "none"); }}>Attribute</Button>
                      <Button variant="ghost" size="sm" onClick={() => { setManualFor(a); setManualAmount(a.costSource === "manual" && a.costCents != null ? (a.costCents / 100).toFixed(2) : ""); }}>Manual $</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableShell>
      </Section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Register hosted app</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Provider</Label>
                <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="railway">Railway</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Label</Label>
                <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Buildorata prod" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>{form.provider === "railway" ? "Railway service ID" : "External reference"}</Label>
              <Input value={form.externalRef} onChange={(e) => setForm({ ...form, externalRef: e.target.value })} className="font-mono" placeholder="d6485e9c-…" />
            </div>
            <div className="grid gap-2">
              <Label>Attribute to product (optional)</Label>
              <Select value={form.productId} onValueChange={(v) => setForm({ ...form, productId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None yet</SelectItem>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={add} disabled={isPending("add") || !form.label || !form.externalRef}>Register</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!linkFor} onOpenChange={(o) => !o && setLinkFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attribute {linkFor?.label}</DialogTitle>
            <DialogDescription>
              Shared apps split their cost across every live subscriber of the linked products. A dedicated app puts its whole cost on one client&apos;s subscription.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Shared by products</Label>
              <div className="flex flex-col gap-2">
                {products.map((p) => {
                  const linked = linkFor?.products.some((x) => x.id === p.id) ?? false;
                  return (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={linked}
                        disabled={isPending(`link:${p.id}`)}
                        onCheckedChange={async (v) => {
                          if (!linkFor) return;
                          const res = await run(() => toggleAppProductLinkAction(linkFor.id, p.id, Boolean(v)), { key: `link:${p.id}` });
                          if (res?.ok) {
                            setLinkFor({
                              ...linkFor,
                              products: v ? [...linkFor.products, p] : linkFor.products.filter((x) => x.id !== p.id),
                            });
                          }
                        }}
                      />
                      {p.name}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Dedicated to one subscription</Label>
              <Select value={dedicate} onValueChange={setDedicate}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not dedicated (shared)</SelectItem>
                  {subscriptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.tenantName} · {s.productName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="w-fit"
                disabled={isPending("dedicate") || !linkFor || (linkFor.dedicated?.subscriptionId ?? "none") === dedicate}
                onClick={async () => {
                  if (!linkFor) return;
                  const sub = subscriptions.find((s) => s.id === dedicate);
                  const productId = sub?.productId ?? linkFor.dedicated?.productId ?? linkFor.products[0]?.id;
                  if (!productId) {
                    toast.error("Pick a product link first");
                    return;
                  }
                  const res = await run(() => setAppSubscriptionLinkAction(linkFor.id, productId, sub ? sub.id : null), {
                    key: "dedicate",
                    success: sub ? `${linkFor.label} now dedicated to ${sub.tenantName}` : `${linkFor.label} is shared again`,
                  });
                  if (res?.ok) setLinkFor(null);
                }}
              >
                Save dedication
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!manualFor} onOpenChange={(o) => !o && setManualFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Manual cost — {manualFor?.label} ({formatMonth(month)})</DialogTitle></DialogHeader>
          <div className="grid gap-2">
            <Label>Amount (USD)</Label>
            <Input value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} placeholder="42.50" />
            <p className="text-xs text-muted-foreground">Overrides the API-derived figure for this month.</p>
          </div>
          <DialogFooter>
            <Button
              disabled={isPending("manual") || !manualAmount}
              onClick={async () => {
                if (!manualFor) return;
                const res = await run(() => upsertManualCostAction(manualFor.id, month, manualAmount), { key: "manual", success: "Manual cost saved" });
                if (res?.ok) setManualFor(null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
