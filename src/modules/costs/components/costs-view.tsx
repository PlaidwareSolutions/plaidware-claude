"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, RefreshCw, Server } from "lucide-react";
import {
  registerHostedAppAction,
  syncRailwayNowAction,
  toggleAppProductLinkAction,
  upsertManualCostAction,
} from "../actions";
import { formatCents } from "@/lib/money";
import { formatMonth } from "@/lib/dates";
import { OPS } from "@/lib/routes";
import { Section } from "@/components/section";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
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
type AppRow = {
  id: string; provider: string; externalRef: string; label: string;
  costCents: number | null; costSource: string | null; products: Option[];
};
type MarginRow = {
  productId: string; productName: string;
  revenueCents: number; costCents: number | null; marginPct: number | null;
};
export function CostsView({
  month, apps, margins, products,
}: {
  month: string; apps: AppRow[]; margins: MarginRow[]; products: Option[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ provider: "railway", externalRef: "", label: "", productId: "none" });
  const [linkFor, setLinkFor] = useState<AppRow | null>(null);
  const [manualFor, setManualFor] = useState<AppRow | null>(null);
  const [manualAmount, setManualAmount] = useState("");

  async function sync() {
    setBusy(true);
    const res = await syncRailwayNowAction();
    setBusy(false);
    if (res.ok) {
      toast.success(`Synced ${res.apps} apps — ${formatCents(res.totalCents)} month-to-date`);
      router.refresh();
    } else toast.error(res.error);
  }

  async function add() {
    setBusy(true);
    const res = await registerHostedAppAction({
      provider: form.provider as "railway" | "other",
      externalRef: form.externalRef,
      label: form.label,
      productId: form.productId === "none" ? null : form.productId,
    });
    setBusy(false);
    if (res.ok) {
      toast.success("App registered");
      setAddOpen(false);
      setForm({ provider: "railway", externalRef: "", label: "", productId: "none" });
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {formatMonth(month)} — synced daily from Railway; manual entries override.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-1" onClick={sync} disabled={busy}>
            <RefreshCw className="size-4" /> {busy ? "Syncing…" : "Sync Railway now"}
          </Button>
          <Button className="gap-1" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Register app
          </Button>
        </div>
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
              {margins.length === 0 && (
                <TableEmpty colSpan={4} title="No active products" />
              )}
              {margins.map((m) => (
                <TableRow key={m.productId}>
                  <TableCell>
                    <Link href={OPS.product(m.productId)} className="font-medium text-heading hover:text-primary">
                      {m.productName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(m.revenueCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.costCents != null ? formatCents(m.costCents) : "—"}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${m.marginPct == null ? "" : m.marginPct >= 70 ? "text-success" : m.marginPct >= 40 ? "text-warning" : "text-destructive"}`}>
                    {m.marginPct != null ? `${m.marginPct}%` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableShell>
      </Section>

      <Section title="Hosted apps" count={apps.length}>
      <DataTableShell>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>App</TableHead>
              <TableHead className="hidden md:table-cell">Products</TableHead>
              <TableHead className="text-right">Cost ({formatMonth(month)})</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {apps.length === 0 && (
              <TableEmpty
                colSpan={4}
                icon={Server}
                title="No hosted apps registered"
                description="Register your Railway services to start attributing cost to products."
              />
            )}
            {apps.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <div className="font-medium text-heading">{a.label}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{a.provider} · {a.externalRef}</div>
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {a.products.length === 0
                    ? "—"
                    : a.products.map((p, i) => (
                        <span key={p.id}>
                          {i > 0 && ", "}
                          <Link href={OPS.product(p.id)} className="hover:text-primary">{p.name}</Link>
                        </span>
                      ))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {a.costCents != null ? formatCents(a.costCents) : "—"}
                  {a.costSource && <Badge variant="outline" className="ml-1 text-[9px]">{a.costSource === "manual" ? "manual" : "api"}</Badge>}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setLinkFor(a)}>Link</Button>
                    <Button variant="ghost" size="sm" onClick={() => { setManualFor(a); setManualAmount(""); }}>Manual $</Button>
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
            <Button onClick={add} disabled={busy || !form.label || !form.externalRef}>Register</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!linkFor} onOpenChange={(o) => !o && setLinkFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Link {linkFor?.label} to products</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-2">
            {products.map((p) => {
              const linked = linkFor?.products.some((x) => x.id === p.id) ?? false;
              return (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={linked}
                    onCheckedChange={async (v) => {
                      if (!linkFor) return;
                      const res = await toggleAppProductLinkAction(linkFor.id, p.id, Boolean(v));
                      if (res.ok) {
                        setLinkFor({
                          ...linkFor,
                          products: v ? [...linkFor.products, p] : linkFor.products.filter((x) => x.id !== p.id),
                        });
                        router.refresh();
                      } else toast.error(res.error);
                    }}
                  />
                  {p.name}
                </label>
              );
            })}
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
              disabled={busy || !manualAmount}
              onClick={async () => {
                if (!manualFor) return;
                setBusy(true);
                const res = await upsertManualCostAction(manualFor.id, month, manualAmount);
                setBusy(false);
                if (res.ok) { toast.success("Manual cost saved"); setManualFor(null); router.refresh(); }
                else toast.error(res.error);
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
