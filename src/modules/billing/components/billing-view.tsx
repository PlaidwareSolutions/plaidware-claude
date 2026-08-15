"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ExternalLink, Receipt } from "lucide-react";
import type { InvoiceDto, SubscriptionDto } from "../queries";
import { billingPortalAction, cancelSubscriptionAction, changeSubscriptionItemsAction } from "../actions";
import { intervalLabel } from "../mappers";
import { setDomainAction } from "@/modules/provisioning/actions";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function DomainEditor({ tenantId, sub }: { tenantId: string; sub: SubscriptionDto }) {
  const [value, setValue] = useState(sub.domainUrl ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await setDomainAction({ tenantId, subscriptionId: sub.id, domainUrl: value.trim() || null });
    setSaving(false);
    if (res.ok) toast.success(value.trim() ? "Live URL saved" : "Live URL cleared");
    else toast.error(res.error);
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        className="h-8 w-56 text-xs"
        placeholder="Live URL (https://…)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button variant="outline" size="sm" onClick={save} disabled={saving || value === (sub.domainUrl ?? "")}>
        {saving ? "…" : "Save"}
      </Button>
    </div>
  );
}

function statusBadge(status: string) {
  const variant =
    status === "active" || status === "paid"
      ? ("secondary" as const)
      : status === "trialing" || status === "open" || status === "incomplete"
        ? ("outline" as const)
        : ("destructive" as const);
  return <Badge variant={variant}>{status.replace("_", " ")}</Badge>;
}

export type AddonOption = {
  id: string;
  name: string;
  kind: string;
  interval: string | null;
  intervalCount: number;
  amountCents: number;
};

export function BillingView({
  tenantId,
  canWrite,
  subscriptions,
  invoices,
  addonOptions = {},
}: {
  tenantId: string;
  canWrite: boolean;
  subscriptions: SubscriptionDto[];
  invoices: InvoiceDto[];
  addonOptions?: Record<string, AddonOption[]>;
}) {
  const [busy, setBusy] = useState(false);
  const totalMonthly = subscriptions.reduce((s, x) => s + x.monthlyCents, 0);

  async function openPortal() {
    setBusy(true);
    const res = await billingPortalAction(tenantId);
    setBusy(false);
    if (res.ok) window.location.href = res.url;
    else toast.error(res.error);
  }

  async function cancel(sub: SubscriptionDto) {
    if (!confirm(`Cancel ${sub.productName}? Recurring charges stop; one-time work already delivered is not refunded.`)) return;
    const res = await cancelSubscriptionAction(tenantId, sub.id);
    if (res.ok) toast.success(`${sub.productName} canceled`);
    else toast.error(res.error ?? "Cancel failed");
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-heading">Billing</h1>
          <p className="text-sm text-muted-foreground">
            {totalMonthly > 0
              ? `Current recurring total: ${formatCents(totalMonthly)}/mo`
              : "Subscriptions and invoices for this workspace."}
          </p>
        </div>
        <Button variant="outline" onClick={openPortal} disabled={busy}>
          {busy ? "Opening…" : "Manage payment methods"}
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        {subscriptions.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <Receipt className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No subscriptions yet.
              </p>
              <Button asChild size="sm">
                <Link href="/products">Browse the catalog</Link>
              </Button>
            </CardContent>
          </Card>
        )}
        {subscriptions.map((sub) => (
          <Card key={sub.id}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: sub.productColor ?? "var(--primary)" }}
                />
                {sub.productName}
                {statusBadge(sub.status)}
              </CardTitle>
              <div className="text-sm text-muted-foreground">
                {sub.status === "trialing" && sub.trialEndsAt
                  ? `Trial ends ${new Date(sub.trialEndsAt).toLocaleDateString()}`
                  : sub.currentPeriodEnd
                    ? `Renews ${new Date(sub.currentPeriodEnd).toLocaleDateString()}`
                    : `Since ${new Date(sub.subscribedAt).toLocaleDateString()}`}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul className="flex flex-col gap-1 text-sm">
                {sub.items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">
                      {i.name}
                      {i.status === "paid" && " · paid"}
                      {i.status === "pending" && " · awaiting payment"}
                    </span>
                    <span className="tabular-nums">
                      {formatCents(i.amountCents)}
                      {intervalLabel(i)}
                    </span>
                  </li>
                ))}
              </ul>
              {canWrite && !["canceled", "expired"].includes(sub.status) && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <DomainEditor tenantId={tenantId} sub={sub} />
                  <div className="flex-1" />
                  {(addonOptions[sub.id]?.length || sub.items.some((i) => i.status === "active")) && (
                    <ManageAddons
                      tenantId={tenantId}
                      sub={sub}
                      options={addonOptions[sub.id] ?? []}
                    />
                  )}
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => cancel(sub)}>
                    Cancel subscription
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {invoices.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-heading">Invoices</h2>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                    <TableCell>{statusBadge(inv.status)}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(inv.amountDueCents)}
                    </TableCell>
                    <TableCell>
                      {inv.hostedInvoiceUrl && (
                        <a
                          href={inv.hostedInvoiceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary"
                          title="View invoice"
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function ManageAddons({
  tenantId,
  sub,
  options,
}: {
  tenantId: string;
  sub: SubscriptionDto;
  options: AddonOption[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toAdd, setToAdd] = useState<Set<string>>(new Set());
  const [toRemove, setToRemove] = useState<Set<string>>(new Set());

  // Removable = active recurring items beyond the base (base can't be removed).
  const removable = sub.items.filter(
    (i) => i.status === "active" && i.interval != null,
  );

  async function apply() {
    setBusy(true);
    const res = await changeSubscriptionItemsAction({
      tenantId,
      subscriptionId: sub.id,
      addComponentIds: [...toAdd],
      removeItemIds: [...toRemove],
    });
    setBusy(false);
    if (res.ok) {
      toast.success(
        `Updated — ${res.added} added, ${res.removed} removed. Prorated charges/credits apply immediately.`,
      );
      setOpen(false);
      setToAdd(new Set());
      setToRemove(new Set());
      window.location.reload();
    } else toast.error(res.error);
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Manage add-ons
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-xl border bg-card p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-semibold text-heading">Manage add-ons</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Recurring changes are prorated immediately; one-time add-ons are
              charged right away.
            </p>
            {options.length > 0 && (
              <div className="mb-4">
                <div className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">Available</div>
                <div className="flex flex-col gap-2">
                  {options.map((o) => (
                    <label key={o.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={toAdd.has(o.id)}
                          onChange={(e) => {
                            const next = new Set(toAdd);
                            if (e.target.checked) next.add(o.id);
                            else next.delete(o.id);
                            setToAdd(next);
                          }}
                        />
                        {o.name}
                      </span>
                      <span className="tabular-nums text-heading">
                        {formatCents(o.amountCents)}
                        {o.kind === "one_time" ? " once" : intervalLabel(o)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {removable.length > 0 && (
              <div className="mb-4">
                <div className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">Current recurring items</div>
                <div className="flex flex-col gap-2">
                  {removable.map((i) => (
                    <label key={i.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={toRemove.has(i.id)}
                          onChange={(e) => {
                            const next = new Set(toRemove);
                            if (e.target.checked) next.add(i.id);
                            else next.delete(i.id);
                            setToRemove(next);
                          }}
                        />
                        Remove {i.name}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatCents(i.amountCents)}
                        {intervalLabel(i)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
              <Button size="sm" onClick={apply} disabled={busy || (toAdd.size === 0 && toRemove.size === 0)}>
                {busy ? "Applying…" : "Apply changes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
