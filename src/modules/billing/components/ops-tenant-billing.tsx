"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, FilePlus2, HandCoins } from "lucide-react";
import type { SubscriptionDto } from "../queries";
import {
  createManualInvoiceAction,
  recordOfflinePaymentAction,
  setHostingFeeAction,
  toggleDunningPauseAction,
} from "../ar-actions";
import { formatCents, toCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const [busy, setBusy] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [lines, setLines] = useState([{ name: "", amount: "" }]);
  const [daysUntilDue, setDaysUntilDue] = useState("14");
  const [memo, setMemo] = useState("");
  const [payFor, setPayFor] = useState<InvoiceRow | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", method: "check", reference: "" });
  const [hostingFor, setHostingFor] = useState<SubscriptionDto | null>(null);
  const [hostingForm, setHostingForm] = useState({ amount: "", startMonth: "" });

  async function createInvoice() {
    setBusy(true);
    try {
      const lineItems = lines
        .filter((l) => l.name && l.amount)
        .map((l) => ({ name: l.name, amountCents: toCents(l.amount) }));
      const res = await createManualInvoiceAction({
        tenantId: tenant.id,
        lineItems,
        daysUntilDue: parseInt(daysUntilDue, 10),
        memo: memo || undefined,
      });
      if (res.ok) {
        toast.success("Invoice created — Stripe emailed the payment link");
        setInvoiceOpen(false);
        setLines([{ name: "", amount: "" }]);
        setMemo("");
        router.refresh();
      } else toast.error(res.error);
    } catch {
      toast.error("Check the line-item amounts");
    } finally {
      setBusy(false);
    }
  }

  async function recordPayment() {
    if (!payFor) return;
    setBusy(true);
    try {
      const res = await recordOfflinePaymentAction({
        invoiceId: payFor.id,
        amountCents: toCents(payForm.amount),
        method: payForm.method as "check" | "zelle" | "wire" | "other",
        reference: payForm.reference || undefined,
      });
      if (res.ok) {
        toast.success(
          res.settled ? "Payment recorded — invoice settled" : "Partial payment recorded",
        );
        setPayFor(null);
        setPayForm({ amount: "", method: "check", reference: "" });
        router.refresh();
      } else toast.error(res.error);
    } catch {
      toast.error("Enter a valid amount");
    } finally {
      setBusy(false);
    }
  }

  async function saveHosting() {
    if (!hostingFor) return;
    setBusy(true);
    try {
      const cents = hostingForm.amount ? toCents(hostingForm.amount) : 0;
      const res = await setHostingFeeAction({
        subscriptionId: hostingFor.id,
        monthlyHostingCents: cents,
        startMonth: hostingForm.startMonth || null,
      });
      if (res.ok) {
        toast.success(cents ? "Hosting fee configured" : "Hosting fee removed");
        setHostingFor(null);
        router.refresh();
      } else toast.error(res.error);
    } catch {
      toast.error("Enter a valid amount");
    } finally {
      setBusy(false);
    }
  }

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
          <Button className="gap-2" onClick={() => setInvoiceOpen(true)}>
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
                onClick={() => {
                  setHostingFor(s);
                  setHostingForm({ amount: "", startMonth: new Date().toISOString().slice(0, 7) });
                }}
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
                          onClick={() => {
                            setPayFor(inv);
                            setPayForm({
                              amount: ((inv.amountDueCents - inv.amountPaidCents) / 100).toFixed(2),
                              method: "check",
                              reference: "",
                            });
                          }}
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

      {/* New manual invoice */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New invoice for {tenant.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_120px] gap-2">
                <Input
                  placeholder="Line item description"
                  value={l.name}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <Input
                  placeholder="500.00"
                  value={l.amount}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                />
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-fit" onClick={() => setLines([...lines, { name: "", amount: "" }])}>
              Add line
            </Button>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Days until due</Label>
                <Input value={daysUntilDue} onChange={(e) => setDaysUntilDue(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Memo (optional)</Label>
                <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The customer receives a Stripe-hosted payment link by email (card or
              ACH). You can also record offline payments against it.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={createInvoice} disabled={busy || !lines.some((l) => l.name && l.amount)}>
              {busy ? "Creating…" : "Create & send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record offline payment */}
      <Dialog open={!!payFor} onOpenChange={(o) => !o && setPayFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment — {payFor?.invoiceNumber}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Amount (USD)</Label>
                <Input value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Method</Label>
                <Select value={payForm.method} onValueChange={(v) => setPayForm({ ...payForm, method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="zelle">Zelle</SelectItem>
                    <SelectItem value="wire">Wire</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Reference (check #, confirmation…)</Label>
              <Input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">
              Partial amounts are fine — the invoice settles when payments cover
              the total, and any suspension lifts automatically.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={recordPayment} disabled={busy || !payForm.amount}>
              {busy ? "Recording…" : "Record payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hosting fee */}
      <Dialog open={!!hostingFor} onOpenChange={(o) => !o && setHostingFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hosting fee — {hostingFor?.productName}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Monthly fee (USD, 0 to remove)</Label>
                <Input placeholder="79.00" value={hostingForm.amount} onChange={(e) => setHostingForm({ ...hostingForm, amount: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>First billed month</Label>
                <Input type="month" value={hostingForm.startMonth} onChange={(e) => setHostingForm({ ...hostingForm, startMonth: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Invoiced through Stripe on the 1st for the previous month —
              auto-charged when a card is on file, otherwise a hosted payment
              link is emailed.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={saveHosting} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
