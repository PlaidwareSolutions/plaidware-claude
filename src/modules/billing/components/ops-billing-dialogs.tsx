"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createManualInvoiceAction,
  recordOfflinePaymentAction,
  setHostingFeeAction,
} from "../ar-actions";
import { toCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
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

/**
 * The three ops billing dialogs, shared by the tenant page and the Billing
 * board. Each is open while its target is non-null. Render with
 * `key={target?.id ?? "none"}` so form state resets per target.
 */

export type TenantTarget = { id: string; name: string };
export type InvoiceTarget = {
  id: string;
  invoiceNumber: string;
  amountDueCents: number;
  amountPaidCents: number;
};
export type HostingTarget = {
  id: string;
  productName: string;
  /** Current fee, so the dialog opens prefilled and "Remove fee" is explicit. */
  monthlyHostingCents?: number | null;
  hostingBillingStartMonth?: string | null;
  /** Product's suggested fee: prefills an empty dialog, never applied on its own. */
  suggestedCents?: number | null;
};

type DialogProps<T> = { target: T | null; onOpenChange: (open: boolean) => void };

export function NewInvoiceDialog({ target, onOpenChange }: DialogProps<TenantTarget>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState([{ name: "", amount: "" }]);
  const [daysUntilDue, setDaysUntilDue] = useState("14");
  const [collect, setCollect] = useState<"send" | "auto">("send");
  const [memo, setMemo] = useState("");

  async function submit() {
    if (!target) return;
    setBusy(true);
    try {
      const lineItems = lines
        .filter((l) => l.name && l.amount)
        .map((l) => ({ name: l.name, amountCents: toCents(l.amount) }));
      const res = await createManualInvoiceAction({
        tenantId: target.id,
        lineItems,
        daysUntilDue: parseInt(daysUntilDue, 10),
        memo: memo || undefined,
        collect,
      });
      if (res.ok) {
        toast.success(
          collect === "auto"
            ? "Invoice created — charging the card on file"
            : "Invoice created — Stripe emailed the payment link",
        );
        onOpenChange(false);
        router.refresh();
      } else toast.error(res.error);
    } catch {
      toast.error("Check the line-item amounts");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New invoice for {target?.name}</DialogTitle>
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
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={collect === "send"} onChange={() => setCollect("send")} />
              Email payment link
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={collect === "auto"} onChange={() => setCollect("auto")} />
              Charge card on file now
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Auto-charge falls back to the emailed link when no card is on
            file. Offline payments can be recorded against either.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy || !lines.some((l) => l.name && l.amount)}>
            {busy ? "Creating…" : "Create & send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RecordPaymentDialog({ target, onOpenChange }: DialogProps<InvoiceTarget>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    amount: target ? ((target.amountDueCents - target.amountPaidCents) / 100).toFixed(2) : "",
    method: "check",
    reference: "",
  });

  async function submit() {
    if (!target) return;
    setBusy(true);
    try {
      const res = await recordOfflinePaymentAction({
        invoiceId: target.id,
        amountCents: toCents(form.amount),
        method: form.method as "check" | "zelle" | "wire" | "other",
        reference: form.reference || undefined,
      });
      if (res.ok) {
        toast.success(res.settled ? "Payment recorded — invoice settled" : "Partial payment recorded");
        onOpenChange(false);
        router.refresh();
      } else toast.error(res.error);
    } catch {
      toast.error("Enter a valid amount");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment — {target?.invoiceNumber}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Amount (USD)</Label>
              <Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Method</Label>
              <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
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
            <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </div>
          <p className="text-xs text-muted-foreground">
            Partial amounts are fine — the invoice settles when payments cover
            the total, and any suspension lifts automatically.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy || !form.amount}>
            {busy ? "Recording…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HostingFeeDialog({ target, onOpenChange }: DialogProps<HostingTarget>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const hasFee = target?.monthlyHostingCents != null && target.monthlyHostingCents > 0;
  const [form, setForm] = useState({
    amount: hasFee
      ? (target!.monthlyHostingCents! / 100).toFixed(2)
      : target?.suggestedCents
        ? (target.suggestedCents / 100).toFixed(2)
        : "",
    startMonth: target?.hostingBillingStartMonth ?? new Date().toISOString().slice(0, 7),
  });

  async function save(cents: number) {
    if (!target) return;
    setBusy(true);
    try {
      const res = await setHostingFeeAction({
        subscriptionId: target.id,
        monthlyHostingCents: cents,
        startMonth: form.startMonth || null,
      });
      if (res.ok) {
        toast.success(cents ? `Hosting fee set — ${target.productName} bills it on the 1st` : "Hosting fee removed");
        onOpenChange(false);
        router.refresh();
      } else toast.error(res.error);
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    let cents: number;
    try {
      cents = toCents(form.amount);
    } catch {
      toast.error("Enter a valid amount");
      return;
    }
    if (cents <= 0) {
      toast.error("Enter an amount, or use Remove fee");
      return;
    }
    void save(cents);
  }

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hosting fee — {target?.productName}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          {hasFee ? (
            <p className="text-sm text-muted-foreground">
              Currently <span className="font-medium text-heading">${(target!.monthlyHostingCents! / 100).toFixed(2)}/mo</span>
              {target?.hostingBillingStartMonth ? ` since ${target.hostingBillingStartMonth}` : ""}.
            </p>
          ) : (
            target?.suggestedCents && (
              <p className="text-sm text-muted-foreground">
                The product suggests <span className="font-medium text-heading">${(target.suggestedCents / 100).toFixed(2)}/mo</span> — prefilled, nothing is charged until you save.
              </p>
            )
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Monthly fee (USD)</Label>
              <Input placeholder="79.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>First billed month</Label>
              <Input type="month" value={form.startMonth} onChange={(e) => setForm({ ...form, startMonth: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Invoiced through Stripe on the 1st for the previous month —
            auto-charged when a card is on file, otherwise a hosted payment
            link is emailed.
          </p>
        </div>
        <DialogFooter className="sm:justify-between">
          {hasFee ? (
            <Button variant="ghost" className="text-destructive" onClick={() => void save(0)} disabled={busy}>
              Remove fee
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={submit} disabled={busy || !form.amount}>
            {busy ? "Saving…" : hasFee ? "Update fee" : "Set fee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
