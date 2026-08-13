"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Ticket } from "lucide-react";
import type { PromoRow } from "../queries";
import {
  archivePromoAction,
  createPromoAction,
  runOrphanSweepAction,
  syncPromoAction,
  togglePromoAssignmentAction,
} from "../actions";
import { formatCents, toCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type Option = { id: string; name: string };

const DEFAULT_FORM = {
  code: "",
  kind: "percent_off" as "percent_off" | "amount_off" | "fixed_price" | "free_periods",
  value: "",
  duration: "once" as "once" | "repeating" | "forever",
  durationMonths: "3",
  productId: "all",
  maxRedemptions: "",
  redeemBy: "",
  isPublic: true,
  autoApply: false,
};

export function PromoManager({
  promos,
  tenants,
  products,
}: {
  promos: PromoRow[];
  tenants: Option[];
  products: Option[];
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [assignFor, setAssignFor] = useState<PromoRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    let value: number;
    try {
      value =
        form.kind === "percent_off" || form.kind === "free_periods"
          ? parseInt(form.value, 10)
          : toCents(form.value);
      if (!Number.isFinite(value)) throw new Error();
    } catch {
      setBusy(false);
      toast.error("Enter a valid value for the discount");
      return;
    }
    const res = await createPromoAction({
      code: form.code,
      kind: form.kind,
      percentOff: form.kind === "percent_off" ? value : undefined,
      amountCents: form.kind === "amount_off" || form.kind === "fixed_price" ? value : undefined,
      freePeriods: form.kind === "free_periods" ? value : undefined,
      duration: form.duration,
      durationMonths: form.duration === "repeating" ? parseInt(form.durationMonths, 10) : undefined,
      productId: form.productId === "all" ? null : form.productId,
      maxRedemptions: form.maxRedemptions ? parseInt(form.maxRedemptions, 10) : null,
      redeemBy: form.redeemBy || null,
      isPublic: form.isPublic,
      autoApply: form.autoApply,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Promo ${form.code.toUpperCase()} created`);
      setCreateOpen(false);
      setForm(DEFAULT_FORM);
      router.refresh();
    } else toast.error(res.error);
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    void (async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(okMsg);
        router.refresh();
      } else toast.error(res.error ?? "Failed");
    })();
  }

  async function sweep() {
    setBusy(true);
    const res = await runOrphanSweepAction();
    setBusy(false);
    if (res.ok) toast.success(`Sweep: ${res.deleted} orphaned coupons deleted (${res.scanned} scanned)`);
    else toast.error(res.error);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-heading">Promos</h1>
          <p className="text-sm text-muted-foreground">
            Discount codes, auto-applied offers, and actual dollars saved.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={sweep} disabled={busy}>
            Sweep orphan coupons
          </Button>
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> New promo
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Discount</TableHead>
              <TableHead className="hidden md:table-cell">Scope</TableHead>
              <TableHead className="hidden sm:table-cell">Redeemed</TableHead>
              <TableHead className="hidden sm:table-cell">Saved</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {promos.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  <Ticket className="mx-auto mb-2 size-8 opacity-40" />
                  No promos yet.
                </TableCell>
              </TableRow>
            )}
            {promos.map((p) => (
              <TableRow key={p.id} className={p.isActive ? "" : "opacity-50"}>
                <TableCell>
                  <div className="font-mono text-sm font-semibold text-heading">{p.code}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {!p.isActive && <Badge variant="destructive" className="text-[10px]">archived</Badge>}
                    {p.autoApply && <Badge className="text-[10px]">auto</Badge>}
                    {!p.isPublic && <Badge variant="outline" className="text-[10px]">private · {p.assignedTenantIds.length} tenants</Badge>}
                    {!p.synced && p.isActive && <Badge variant="outline" className="text-[10px]">mints at checkout</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {p.valueLabel}
                  <div className="text-xs text-muted-foreground">{p.durationLabel}</div>
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {p.productName ?? "All products"}
                </TableCell>
                <TableCell className="hidden tabular-nums sm:table-cell">
                  {p.timesRedeemed}
                  {p.maxRedemptions ? ` / ${p.maxRedemptions}` : ""}
                </TableCell>
                <TableCell className="hidden tabular-nums sm:table-cell">
                  {formatCents(p.savingsCents)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {!p.isPublic && (
                      <Button variant="ghost" size="sm" onClick={() => setAssignFor(p)}>
                        Assign
                      </Button>
                    )}
                    {p.isActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => run(() => archivePromoAction(p.id), `${p.code} archived`)}
                      >
                        Archive
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New promo</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Code</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="LAUNCH25"
                className="font-mono uppercase"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Kind</Label>
                <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as typeof form.kind })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent_off">Percent off</SelectItem>
                    <SelectItem value="amount_off">Amount off</SelectItem>
                    <SelectItem value="fixed_price">Fixed price</SelectItem>
                    <SelectItem value="free_periods">Free periods</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>
                  {form.kind === "percent_off"
                    ? "Percent (1–100)"
                    : form.kind === "free_periods"
                      ? "Periods"
                      : "Amount (USD)"}
                </Label>
                <Input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={form.kind === "percent_off" ? "25" : form.kind === "free_periods" ? "2" : "100.00"} />
              </div>
            </div>
            {form.kind !== "free_periods" && form.kind !== "fixed_price" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Duration</Label>
                  <Select value={form.duration} onValueChange={(v) => setForm({ ...form, duration: v as typeof form.duration })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="once">Once</SelectItem>
                      <SelectItem value="repeating">Repeating</SelectItem>
                      <SelectItem value="forever">Forever</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.duration === "repeating" && (
                  <div className="grid gap-2">
                    <Label>Months</Label>
                    <Input value={form.durationMonths} onChange={(e) => setForm({ ...form, durationMonths: e.target.value })} />
                  </div>
                )}
              </div>
            )}
            <div className="grid gap-2">
              <Label>Product scope</Label>
              <Select value={form.productId} onValueChange={(v) => setForm({ ...form, productId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All products</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Max redemptions (blank = unlimited)</Label>
                <Input value={form.maxRedemptions} onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Expires (blank = never)</Label>
                <Input type="date" value={form.redeemBy} onChange={(e) => setForm({ ...form, redeemBy: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-6 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox checked={form.isPublic} onCheckedChange={(v) => setForm({ ...form, isPublic: Boolean(v) })} />
                Public (anyone can use)
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={form.autoApply} onCheckedChange={(v) => setForm({ ...form, autoApply: Boolean(v) })} />
                Auto-apply at checkout
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={create} disabled={busy || !form.code || !form.value}>
              {busy ? "Creating…" : "Create promo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign dialog */}
      <Dialog open={!!assignFor} onOpenChange={(o) => !o && setAssignFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign {assignFor?.code}</DialogTitle>
          </DialogHeader>
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {tenants.map((t) => {
              const assigned = assignFor?.assignedTenantIds.includes(t.id) ?? false;
              return (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={assigned}
                    onCheckedChange={(v) => {
                      if (!assignFor) return;
                      run(
                        () => togglePromoAssignmentAction(assignFor.id, t.id, Boolean(v)),
                        Boolean(v) ? `Assigned to ${t.name}` : `Unassigned from ${t.name}`,
                      );
                      setAssignFor({
                        ...assignFor,
                        assignedTenantIds: v
                          ? [...assignFor.assignedTenantIds, t.id]
                          : assignFor.assignedTenantIds.filter((x) => x !== t.id),
                      });
                    }}
                  />
                  {t.name}
                </label>
              );
            })}
            {tenants.length === 0 && (
              <p className="text-sm text-muted-foreground">No tenants yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
