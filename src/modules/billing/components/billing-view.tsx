"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ExternalLink, Receipt } from "lucide-react";
import type { InvoiceDto, SubscriptionDto } from "../queries";
import { billingPortalAction, cancelSubscriptionAction } from "../actions";
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

function statusBadge(status: string) {
  const variant =
    status === "active" || status === "paid"
      ? ("secondary" as const)
      : status === "trialing" || status === "open" || status === "incomplete"
        ? ("outline" as const)
        : ("destructive" as const);
  return <Badge variant={variant}>{status.replace("_", " ")}</Badge>;
}

export function BillingView({
  tenantId,
  canWrite,
  subscriptions,
  invoices,
}: {
  tenantId: string;
  canWrite: boolean;
  subscriptions: SubscriptionDto[];
  invoices: InvoiceDto[];
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
                      {i.kind === "recurring_monthly" ? "/mo" : i.kind === "recurring_yearly" ? "/yr" : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {canWrite && !["canceled", "expired"].includes(sub.status) && (
                <div>
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
