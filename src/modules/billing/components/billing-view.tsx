"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CreditCard, ExternalLink, Package, Receipt } from "lucide-react";
import type { AddonOption, InvoiceDto, SubscriptionDto } from "../queries";
import { billingPortalAction, cancelSubscriptionAction, changeSubscriptionItemsAction } from "../actions";
import { intervalLabel, isRecurringKind } from "../mappers";
import { setDomainAction } from "@/modules/provisioning/actions";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MARKETING } from "@/lib/routes";

export type { AddonOption };

const cadence = (c: { kind: string; interval?: string | null; intervalCount?: number | null }) =>
  isRecurringKind(c.kind) ? intervalLabel(c) : " one-time";

function DomainEditor({ tenantId, sub }: { tenantId: string; sub: SubscriptionDto }) {
  const { run, isPending } = useAction();
  const [value, setValue] = useState(sub.domainUrl ?? "");

  // marketing-* products: the URL is MHub's portal, written by the
  // provisioning handshake — not customer-editable.
  if (sub.productSlug.startsWith("marketing-")) {
    return sub.domainUrl ? (
      <a href={sub.domainUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
        Open portal
      </a>
    ) : (
      <StatusBadge kind="dns" status="handshake_pending" label="Provisioning pending" />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        className="h-8 w-56 text-xs"
        placeholder="Live URL (https://…)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={isPending(`domain:${sub.id}`) || value.trim() === (sub.domainUrl ?? "")}
        onClick={() =>
          void run(() => setDomainAction({ tenantId, subscriptionId: sub.id, domainUrl: value.trim() || null }), {
            key: `domain:${sub.id}`,
            success: value.trim() ? "Live URL saved" : "Live URL cleared",
          })
        }
      >
        {isPending(`domain:${sub.id}`) ? "…" : "Save"}
      </Button>
    </div>
  );
}

export function BillingView({
  tenantId,
  canWrite,
  readOnlyReason = null,
  subscriptions,
  invoices,
  addonOptions = {},
}: {
  tenantId: string;
  canWrite: boolean;
  /** Set when the workspace status blocks changes (suspended/inactive). */
  readOnlyReason?: string | null;
  subscriptions: SubscriptionDto[];
  invoices: InvoiceDto[];
  addonOptions?: Record<string, AddonOption[]>;
}) {
  const confirm = useConfirm();
  const { run, isPending } = useAction();
  const [portalBusy, setPortalBusy] = useState(false);
  const live = subscriptions.filter((s) => !["canceled", "expired"].includes(s.status));
  const totalMonthly = live.reduce((s, x) => s + x.monthlyCents, 0);

  async function openPortal() {
    setPortalBusy(true);
    const res = await billingPortalAction(tenantId);
    setPortalBusy(false);
    if (res.ok) window.location.href = res.url; // external Stripe-hosted page
    else toast.error(res.error);
  }

  async function cancel(sub: SubscriptionDto) {
    const ok = await confirm({
      title: `Cancel ${sub.productName}?`,
      description: "Recurring charges stop immediately. One-time work already delivered is not refunded.",
      confirmLabel: "Cancel subscription",
      cancelLabel: "Keep it",
      destructive: true,
    });
    if (!ok) return;
    void run(() => cancelSubscriptionAction(tenantId, sub.id), { key: `cancel:${sub.id}`, success: `${sub.productName} canceled` });
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <PageHeader
        title="Billing"
        description={
          readOnlyReason ??
          (totalMonthly > 0 ? `Current recurring total: ${formatCents(totalMonthly)}/mo` : "Subscriptions and invoices for this workspace.")
        }
        actions={
          <Button variant="outline" onClick={openPortal} disabled={portalBusy} className="gap-1.5">
            <CreditCard className="size-4" /> {portalBusy ? "Opening…" : "Payment methods"}
          </Button>
        }
      />

      <Section title="Subscriptions" icon={Package} count={live.length}>
        {subscriptions.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No subscriptions yet"
            description="Products you subscribe to appear here with their items, renewal date, and live URL."
            action={
              canWrite ? (
                <Button asChild size="sm">
                  <Link href={MARKETING.products}>Browse the catalog</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {subscriptions.map((sub) => {
              const open = !["canceled", "expired"].includes(sub.status);
              return (
                <Card key={sub.id} className={`gap-3 py-5 ${open ? "" : "opacity-70"}`}>
                  <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span className="size-2.5 rounded-full" style={{ background: sub.productColor ?? "var(--primary)" }} />
                      {sub.productName}
                      <StatusBadge kind="subscription" status={sub.status} />
                    </CardTitle>
                    <div className="text-sm text-muted-foreground">
                      {sub.status === "trialing" && sub.trialEndsAt
                        ? `Trial ends ${formatDate(sub.trialEndsAt)}`
                        : open && sub.currentPeriodEnd
                          ? `Renews ${formatDate(sub.currentPeriodEnd)}`
                          : `Since ${formatDate(sub.subscribedAt)}`}
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {sub.status === "suspended" && (
                      <p className="text-sm text-destructive">
                        {sub.suspensionSource === "manual"
                          ? "This subscription is on hold — contact Plaidware."
                          : "Suspended over an unpaid invoice — it reactivates automatically once the invoice below is paid."}
                      </p>
                    )}
                    <ul className="flex flex-col gap-1 text-sm">
                      {sub.items.filter((i) => i.status !== "canceled").map((i) => (
                        <li key={i.id} className="flex justify-between gap-2">
                          <span className="text-muted-foreground">
                            {i.name}
                            {i.status === "paid" && <Badge variant="outline" className="ml-1.5 text-[10px]">paid</Badge>}
                            {i.status === "pending" && <Badge variant="outline" className="ml-1.5 text-[10px]">awaiting payment</Badge>}
                          </span>
                          <span className="tabular-nums">
                            {formatCents(i.amountCents)}
                            <span className="text-xs text-muted-foreground">{cadence(i)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {sub.monthlyHostingCents ? (
                      <p className="text-xs text-muted-foreground">
                        Hosting: {formatCents(sub.monthlyHostingCents)}/mo, invoiced on the 1st for the previous month.
                      </p>
                    ) : null}
                    {canWrite && open && (
                      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                        <DomainEditor tenantId={tenantId} sub={sub} />
                        <div className="flex-1" />
                        {(addonOptions[sub.id]?.length || sub.items.some((i) => i.status === "active")) && (
                          <ManageAddons tenantId={tenantId} sub={sub} options={addonOptions[sub.id] ?? []} />
                        )}
                        <Button variant="ghost" size="sm" className="text-destructive" disabled={isPending(`cancel:${sub.id}`)} onClick={() => void cancel(sub)}>
                          Cancel subscription
                        </Button>
                      </div>
                    )}
                    {!canWrite && open && sub.domainUrl && !sub.productSlug.startsWith("marketing-") && (
                      <p className="text-xs text-muted-foreground">Live URL: {sub.domainUrl}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Invoices" icon={Receipt} count={invoices.length}>
        <DataTableShell>
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
              {invoices.length === 0 && <TableEmpty colSpan={5} icon={Receipt} title="No invoices yet" />}
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                  <TableCell><StatusBadge kind="invoice" status={inv.status} /></TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{formatDate(inv.createdAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(inv.amountDueCents)}</TableCell>
                  <TableCell>
                    {inv.hostedInvoiceUrl && (
                      <Button asChild variant="ghost" size="icon" title={inv.status === "open" || inv.status === "failed" ? "Pay invoice" : "View invoice"}>
                        <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-4" />
                        </a>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableShell>
      </Section>
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
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [toAdd, setToAdd] = useState<Set<string>>(new Set());
  const [toRemove, setToRemove] = useState<Set<string>>(new Set());

  // Removable = active recurring items beyond the base (base can't be removed).
  const removable = sub.items.filter((i) => i.status === "active" && i.interval != null);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    setter(next);
  };

  async function apply() {
    const res = await run(
      () =>
        changeSubscriptionItemsAction({
          tenantId,
          subscriptionId: sub.id,
          addComponentIds: [...toAdd],
          removeItemIds: [...toRemove],
        }),
      {
        key: "addons",
        success: (r) => `Updated — ${r.added} added, ${r.removed} removed. Prorated charges or credits apply immediately.`,
      },
    );
    if (res?.ok) {
      setOpen(false);
      setToAdd(new Set());
      setToRemove(new Set());
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Manage add-ons
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage add-ons — {sub.productName}</DialogTitle>
            <DialogDescription>Recurring changes are prorated immediately; one-time add-ons are charged right away.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {options.length > 0 && (
              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Available</div>
                {options.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Checkbox checked={toAdd.has(o.id)} onCheckedChange={(v) => toggle(toAdd, setToAdd, o.id, Boolean(v))} />
                    <span className="flex-1 text-heading">{o.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatCents(o.amountCents)}<span className="text-xs">{cadence(o)}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {removable.length > 0 && (
              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current recurring items</div>
                {removable.map((i) => (
                  <label key={i.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Checkbox checked={toRemove.has(i.id)} onCheckedChange={(v) => toggle(toRemove, setToRemove, i.id, Boolean(v))} />
                    <span className="flex-1 text-heading">Remove {i.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatCents(i.amountCents)}<span className="text-xs">{cadence(i)}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
            <Button size="sm" onClick={apply} disabled={pending || (toAdd.size === 0 && toRemove.size === 0)}>
              {pending ? "Applying…" : "Apply changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
