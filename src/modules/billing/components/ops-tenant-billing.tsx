"use client";

import { useState } from "react";
import Link from "next/link";
import { CreditCard, ExternalLink, FilePlus2, HandCoins, Receipt } from "lucide-react";
import type { OpsInvoiceDto, SubscriptionDto } from "../queries";
import { toggleDunningPauseAction } from "../ar-actions";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { OPS } from "@/lib/routes";
import { useAction } from "@/lib/use-action";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  HostingFeeDialog,
  NewInvoiceDialog,
  RecordPaymentDialog,
  type HostingTarget,
  type InvoiceTarget,
  type TenantTarget,
} from "./ops-billing-dialogs";

export function OpsTenantBilling({
  tenant,
  subscriptions,
  invoices,
  pastDueCount,
}: {
  tenant: { id: string; name: string };
  subscriptions: SubscriptionDto[];
  invoices: OpsInvoiceDto[];
  /** Computed server-side (open past due date, or failed) so the view stays pure. */
  pastDueCount: number;
}) {
  const { run, isPending } = useAction();
  const [invoiceFor, setInvoiceFor] = useState<TenantTarget | null>(null);
  const [payFor, setPayFor] = useState<InvoiceTarget | null>(null);
  const [hostingFor, setHostingFor] = useState<HostingTarget | null>(null);

  return (
    <>
      <Section title="Subscriptions" count={subscriptions.length} icon={CreditCard}>
        {subscriptions.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="No subscriptions"
            description="Products appear here once the client completes a setup link or checkout."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {subscriptions.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
                <span className="size-2 shrink-0 rounded-full" style={{ background: s.productColor ?? "var(--primary)" }} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Link href={OPS.product(s.productId)} className="font-medium text-heading hover:text-primary">
                      {s.productName}
                    </Link>
                    <StatusBadge kind="subscription" status={s.status} />
                    {s.monthlyCents > 0 && (
                      <span className="tabular-nums text-muted-foreground">{formatCents(s.monthlyCents)}/mo</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {s.domainUrl ? (
                      <a href={s.domainUrl} target="_blank" rel="noreferrer" className="hover:text-primary">
                        {s.domainUrl}
                      </a>
                    ) : (
                      "no domain yet"
                    )}
                    {" · "}
                    {s.status === "trialing" && s.trialEndsAt
                      ? `trial ends ${formatDate(s.trialEndsAt)}`
                      : s.currentPeriodEnd
                        ? `renews ${formatDate(s.currentPeriodEnd)}`
                        : `since ${formatDate(s.subscribedAt)}`}
                    {s.items.filter((i) => i.status === "active").length > 1 &&
                      ` · ${s.items.filter((i) => i.status === "active").length} items`}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setHostingFor({ id: s.id, productName: s.productName })}
                >
                  Hosting fee…
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Invoices & payments"
        count={invoices.length}
        icon={Receipt}
        description={
          pastDueCount > 0
            ? `${pastDueCount} past due — dunning sends reminders and suspends automatically`
            : undefined
        }
        actions={
          <Button size="sm" className="gap-2" onClick={() => setInvoiceFor({ id: tenant.id, name: tenant.name })}>
            <FilePlus2 className="size-4" /> New invoice
          </Button>
        }
      >
        <DataTableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Due</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.length === 0 && (
                <TableEmpty
                  colSpan={5}
                  icon={Receipt}
                  title="No invoices yet"
                  description="Stripe invoices sync here automatically; create a manual one for offline work."
                />
              )}
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <div className="font-mono text-xs text-heading">{inv.invoiceNumber}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[10px]">{inv.kind}</Badge>
                      {inv.dunning && !inv.dunning.suspendedAt && (
                        <StatusBadge
                          kind="dunning"
                          status="reminding"
                          label={`dunning · ${inv.dunning.remindersSent} reminder${inv.dunning.remindersSent === 1 ? "" : "s"}`}
                          className="text-[10px]"
                        />
                      )}
                      {inv.dunning?.suspendedAt && (
                        <StatusBadge kind="dunning" status="suspended" className="text-[10px]" />
                      )}
                      {inv.dunning?.paused && (
                        <StatusBadge kind="dunning" status="paused" label="dunning paused" className="text-[10px]" />
                      )}
                    </div>
                    {inv.payments.length > 0 && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {inv.payments.map((p) => (
                          <div key={p.id}>
                            {formatCents(p.amountCents)} · {p.method.replace("_", " ")}
                            {p.reference ? ` · ${p.reference}` : ""} · {formatDate(p.receivedAt)}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{formatDate(inv.createdAt)}</div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="invoice" status={inv.status} />
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                    {formatDate(inv.dueDate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(inv.amountDueCents)}
                    {inv.amountPaidCents > 0 && inv.status !== "paid" && (
                      <div className="text-xs text-success">{formatCents(inv.amountPaidCents)} received</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {inv.hostedInvoiceUrl && (
                        <Button asChild variant="ghost" size="icon" title="Hosted invoice">
                          <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="size-4" />
                          </a>
                        </Button>
                      )}
                      {!["paid", "void"].includes(inv.status) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          onClick={() =>
                            setPayFor({
                              id: inv.id,
                              invoiceNumber: inv.invoiceNumber,
                              amountDueCents: inv.amountDueCents,
                              amountPaidCents: inv.amountPaidCents,
                            })
                          }
                        >
                          <HandCoins className="size-4" /> Record
                        </Button>
                      )}
                      {inv.dunning && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isPending(`dunning:${inv.id}`)}
                          onClick={() => {
                            const d = inv.dunning!;
                            void run(() => toggleDunningPauseAction(d.id, !d.paused), {
                              key: `dunning:${inv.id}`,
                              success: d.paused ? "Dunning resumed" : "Dunning paused",
                            });
                          }}
                        >
                          {inv.dunning.paused ? "Resume" : "Pause"}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableShell>
      </Section>

      <NewInvoiceDialog key={invoiceFor?.id ?? "none"} target={invoiceFor} onOpenChange={(o) => !o && setInvoiceFor(null)} />
      <RecordPaymentDialog key={payFor?.id ?? "none"} target={payFor} onOpenChange={(o) => !o && setPayFor(null)} />
      <HostingFeeDialog key={hostingFor?.id ?? "none"} target={hostingFor} onOpenChange={(o) => !o && setHostingFor(null)} />
    </>
  );
}
