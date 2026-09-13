"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, FilePlus2, HandCoins } from "lucide-react";
import type { SubscriptionDto } from "../queries";
import { toggleDunningPauseAction } from "../ar-actions";
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
import {
  HostingFeeDialog,
  NewInvoiceDialog,
  RecordPaymentDialog,
  type HostingTarget,
  type InvoiceTarget,
  type TenantTarget,
} from "./ops-billing-dialogs";

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  kind: string;
  status: string;
  amountDueCents: number;
  amountPaidCents: number;
  hostedInvoiceUrl: string | null;
  dueDate: string | null;
  createdAt: string;
  dunning: {
    id: string;
    remindersSent: number;
    suspendedAt: string | null;
    paused: boolean;
  } | null;
  payments: {
    id: string;
    amountCents: number;
    method: string;
    reference: string | null;
    receivedAt: string;
  }[];
};

function invoiceBadge(status: string) {
  const variant =
    status === "paid" ? ("secondary" as const)
    : status === "open" || status === "draft" ? ("outline" as const)
    : ("destructive" as const);
  return <Badge variant={variant}>{status}</Badge>;
}

export function OpsTenantBilling({
  tenant,
  subscriptions,
  invoices,
}: {
  tenant: { id: string; name: string; slug: string; status: string; memberCount: number };
  subscriptions: SubscriptionDto[];
  invoices: InvoiceRow[];
}) {
  const router = useRouter();
  const [invoiceFor, setInvoiceFor] = useState<TenantTarget | null>(null);
  const [payFor, setPayFor] = useState<InvoiceTarget | null>(null);
  const [hostingFor, setHostingFor] = useState<HostingTarget | null>(null);

  const pastDue = invoices.filter(
    (i) => (i.status === "open" && i.dueDate && new Date(i.dueDate) < new Date()) || i.status === "failed",
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <Link href="/ops/tenants" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Tenants
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-heading">{tenant.name}</h1>
          <Badge variant={tenant.status === "active" ? "secondary" : "destructive"}>{tenant.status}</Badge>
          <span className="text-sm text-muted-foreground">
            {tenant.slug} · {tenant.memberCount} members
          </span>
          <div className="flex-1" />
          <Button className="gap-2" onClick={() => setInvoiceFor({ id: tenant.id, name: tenant.name })}>
            <FilePlus2 className="size-4" /> New invoice
          </Button>
        </div>
        {pastDue.length > 0 && (
          <p className="mt-2 text-sm text-warning">
            {pastDue.length} past-due {pastDue.length === 1 ? "invoice" : "invoices"} — dunning handles reminders and suspension automatically.
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subscriptions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {subscriptions.length === 0 && (
            <p className="text-sm text-muted-foreground">No subscriptions.</p>
          )}
          {subscriptions.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="size-2 rounded-full" style={{ background: s.productColor ?? "var(--primary)" }} />
                <span className="font-medium text-heading">{s.productName}</span>
                {invoiceBadge(s.status)}
                {s.monthlyCents > 0 && (
                  <span className="text-muted-foreground">{formatCents(s.monthlyCents)}/mo</span>
                )}
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
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-heading">Invoices & payments</h2>
        <div className="rounded-lg border bg-card">
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
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No invoices yet.
                  </TableCell>
                </TableRow>
              )}
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <div className="font-mono text-xs text-heading">{inv.invoiceNumber}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[10px]">{inv.kind}</Badge>
                      {inv.dunning && !inv.dunning.suspendedAt && (
                        <Badge variant="destructive" className="text-[10px]">
                          dunning · {inv.dunning.remindersSent} reminders
                        </Badge>
                      )}
                      {inv.dunning?.suspendedAt && (
                        <Badge variant="destructive" className="text-[10px]">suspended</Badge>
                      )}
                      {inv.dunning?.paused && (
                        <Badge variant="outline" className="text-[10px]">dunning paused</Badge>
                      )}
                    </div>
                    {inv.payments.length > 0 && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {inv.payments.map((p) => (
                          <div key={p.id}>
                            {formatCents(p.amountCents)} · {p.method.replace("_", " ")}
                            {p.reference ? ` · ${p.reference}` : ""} ·{" "}
                            {new Date(p.receivedAt).toLocaleDateString()}
                          </div>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{invoiceBadge(inv.status)}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                    {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(inv.amountDueCents)}
                    {inv.amountPaidCents > 0 && inv.status !== "paid" && (
                      <div className="text-xs text-success">
                        {formatCents(inv.amountPaidCents)} received
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {inv.hostedInvoiceUrl && (
                        <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="p-1 text-primary" title="Hosted invoice">
                          <ExternalLink className="size-4" />
                        </a>
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
                          onClick={async () => {
                            const res = await toggleDunningPauseAction(inv.dunning!.id, !inv.dunning!.paused);
                            if (res.ok) {
                              toast.success(inv.dunning!.paused ? "Dunning resumed" : "Dunning paused");
                              router.refresh();
                            } else toast.error(res.error);
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
        </div>
      </div>

      <NewInvoiceDialog key={invoiceFor?.id ?? "none"} target={invoiceFor} onOpenChange={(o) => !o && setInvoiceFor(null)} />
      <RecordPaymentDialog key={payFor?.id ?? "none"} target={payFor} onOpenChange={(o) => !o && setPayFor(null)} />
      <HostingFeeDialog key={hostingFor?.id ?? "none"} target={hostingFor} onOpenChange={(o) => !o && setHostingFor(null)} />
    </div>
  );
}
