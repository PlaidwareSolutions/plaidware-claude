"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, HandCoins, Receipt } from "lucide-react";
import type { OpsInvoiceDto } from "../queries";
import { toggleDunningPauseAction } from "../ar-actions";
import { formatCents } from "@/lib/money";
import { formatDate, formatDay } from "@/lib/dates";
import { OPS } from "@/lib/routes";
import { useAction } from "@/lib/use-action";
import { StatusBadge } from "@/components/status-badge";
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
import { RecordPaymentDialog, type InvoiceTarget } from "./ops-billing-dialogs";

/** The one invoices table: client page (per client) and Billing board (with a Client column). */
export function InvoicesTable({
  invoices,
  showClient = false,
  emptyTitle = "No invoices yet",
  emptyDescription = "Stripe invoices sync here automatically; create a manual one for offline work.",
}: {
  invoices: OpsInvoiceDto[];
  showClient?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const { run, isPending } = useAction();
  const [payFor, setPayFor] = useState<InvoiceTarget | null>(null);
  const cols = showClient ? 7 : 6;

  return (
    <>
      <DataTableShell>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              {showClient && <TableHead>Client</TableHead>}
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Due</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="hidden text-right md:table-cell">Paid</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 && (
              <TableEmpty colSpan={cols} icon={Receipt} title={emptyTitle} description={emptyDescription} />
            )}
            {invoices.map((inv) => (
              <TableRow key={inv.id} className={inv.pastDue ? "bg-warning/5" : undefined}>
                <TableCell>
                  <div className="font-mono text-xs text-heading">{inv.invoiceNumber}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[10px]">{inv.kind}</Badge>
                    {inv.pastDue && inv.status !== "failed" && (
                      <Badge variant="warning" className="text-[10px]">past due</Badge>
                    )}
                    {inv.dunning && !inv.dunning.suspendedAt && (
                      <StatusBadge
                        kind="dunning"
                        status="reminding"
                        label={`dunning · ${inv.dunning.remindersSent} reminder${inv.dunning.remindersSent === 1 ? "" : "s"}`}
                        className="text-[10px]"
                      />
                    )}
                    {inv.dunning?.suspendedAt && <StatusBadge kind="dunning" status="suspended" className="text-[10px]" />}
                    {inv.dunning?.paused && <StatusBadge kind="dunning" status="paused" label="dunning paused" className="text-[10px]" />}
                  </div>
                  {inv.lineItems.length > 1 || inv.lineItems.some((l) => l.periodStart) ? (
                    <details className="mt-1 text-[11px] text-muted-foreground">
                      <summary className="cursor-pointer">
                        {inv.lineItems.length} line{inv.lineItems.length === 1 ? "" : "s"}
                        {inv.description ? ` · ${inv.description}` : ""}
                      </summary>
                      <ul className="mt-0.5 grid gap-0.5">
                        {inv.lineItems.map((l, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span>
                              {l.name}
                              {l.periodStart && l.periodEnd
                                ? ` · ${formatDay(l.periodStart)} – ${formatDate(new Date(new Date(l.periodEnd).getTime() - 1))}`
                                : ""}
                            </span>
                            <span className="tabular-nums">{formatCents(l.amountCents)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : inv.description ? (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{inv.description}</div>
                  ) : null}
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
                {showClient && (
                  <TableCell>
                    <Link href={OPS.clientTab(inv.tenantId, "billing")} className="hover:text-primary">
                      {inv.tenantName}
                    </Link>
                  </TableCell>
                )}
                <TableCell>
                  <StatusBadge kind="invoice" status={inv.status} />
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{formatDate(inv.dueDate)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCents(inv.amountDueCents)}</TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {inv.amountPaidCents > 0 ? (
                    <span className={inv.status === "paid" ? "text-success" : ""}>{formatCents(inv.amountPaidCents)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
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
                        disabled={isPending(`dun:${inv.id}`)}
                        onClick={() => {
                          const d = inv.dunning!;
                          void run(() => toggleDunningPauseAction(d.id, !d.paused), {
                            key: `dun:${inv.id}`,
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
      <RecordPaymentDialog key={payFor?.id ?? "none"} target={payFor} onOpenChange={(o) => !o && setPayFor(null)} />
    </>
  );
}
