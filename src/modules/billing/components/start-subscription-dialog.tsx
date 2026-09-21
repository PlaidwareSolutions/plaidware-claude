"use client";

import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import type { StartOptionsDto, SubscriptionDto } from "../queries";
import { opsStartSubscriptionAction } from "../ar-actions";
import { createClientSetupAction } from "@/modules/onboarding/actions";
import { buildStartPlan, type StartPlan } from "../start-logic";
import { rowsToItems, seedTermRows, type TermComponent, type TermRow } from "../start-form";
import { ProductTermsEditor } from "./product-terms-editor";
import { formatCents } from "@/lib/money";
import { formatDate, formatMonth, isoDay, monthKey } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { Button } from "@/components/ui/button";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Mode = "start_now" | "charge_card_now" | "setup_link";

const toTerm = (c: StartOptionsDto["products"][number]["components"][number]): TermComponent => ({
  id: c.id,
  name: c.name,
  kind: c.kind,
  role: c.role,
  interval: c.interval,
  intervalCount: c.intervalCount,
  isRequired: c.isRequired,
  isActive: true,
  listCents: c.listCents,
  overrideCents: c.overrideCents,
});

const heading = "text-xs font-semibold uppercase tracking-wider text-muted-foreground";

function monthRange(months: string[]): string {
  if (months.length <= 1) return formatMonth(months[0]);
  return `${formatMonth(months[0])} – ${formatMonth(months[months.length - 1])}`;
}

function recurringLabel(plan: StartPlan): string {
  const parts = [
    plan.totals.monthlyCents ? `${formatCents(plan.totals.monthlyCents)}/mo` : null,
    plan.totals.yearlyCents ? `${formatCents(plan.totals.yearlyCents)}/yr` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" + ") : "no recurring charge";
}

/**
 * Ops starts a subscription on the client's behalf with negotiated terms:
 * per-item prices and quantities, one-time work charged / already paid
 * offline / waived, an optional bill-from month, and how to collect — an
 * emailed invoice (no card), the card on file, or a setup link.
 */
export function StartSubscriptionDialog({
  tenant,
  options,
  priorSubscriptions,
  open,
  onOpenChange,
}: {
  tenant: { id: string; name: string };
  options: StartOptionsDto;
  priorSubscriptions: SubscriptionDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { run, pending } = useAction();
  const startable = useMemo(() => options.products.filter((p) => !p.hasLiveSubscription), [options.products]);
  const [productId, setProductId] = useState(startable.length === 1 ? startable[0].id : "");
  const [rows, setRows] = useState<Record<string, TermRow>>(() =>
    startable.length === 1 ? seedTermRows(startable[0].components.map(toTerm), isoDay()) : {},
  );
  const [mode, setMode] = useState<Mode>("start_now");
  const [daysUntilDue, setDaysUntilDue] = useState("14");
  const [billFrom, setBillFrom] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [useTrial, setUseTrial] = useState(false);
  const [saveAsCustom, setSaveAsCustom] = useState(true);
  const [created, setCreated] = useState<{ link: string; emailed: boolean } | null>(null);

  const product = startable.find((p) => p.id === productId) ?? null;
  const components = useMemo(() => product?.components.map(toTerm) ?? [], [product]);
  const prior = priorSubscriptions
    .filter((s) => s.productId === productId && ["canceled", "expired"].includes(s.status))
    .sort((a, b) => b.subscribedAt.localeCompare(a.subscribedAt))[0];

  function pickProduct(id: string) {
    setProductId(id);
    const p = startable.find((x) => x.id === id);
    setRows(p ? seedTermRows(p.components.map(toTerm), isoDay()) : {});
  }

  const backdated = billFrom !== "";
  const skipTrial = mode === "setup_link" || backdated || !useTrial;

  // Live preview: the same pure rules the server applies.
  const preview = useMemo((): { ok: true; plan: StartPlan } | { ok: false; errors: string[] } => {
    if (!product) return { ok: false, errors: ["Choose a product"] };
    try {
      const items = rowsToItems(components, rows);
      return buildStartPlan({ items, components, trialDays: product.trialDays, skipTrial, billFromMonth: billFrom || null });
    } catch (e) {
      return { ok: false, errors: [e instanceof Error ? e.message : "Check the amounts"] };
    }
  }, [product, components, rows, skipTrial, billFrom]);
  const plan = preview.ok ? preview.plan : null;
  const errors = preview.ok ? [] : [...preview.errors];
  const days = parseInt(daysUntilDue, 10);
  if (mode === "start_now" && !(Number.isInteger(days) && days >= 1 && days <= 90)) errors.push("Days until due must be 1–90");
  if (mode === "charge_card_now" && !options.cardOnFile) errors.push("No card on file");
  if (mode === "setup_link" && !options.ownerEmail) errors.push("This workspace has no owner to send a link to");
  if (!options.stripeConfigured) errors.push("Stripe isn't configured");
  const canSubmit = Boolean(plan) && errors.length === 0 && !pending;

  async function submit() {
    if (!product || !plan) return;
    const items = rowsToItems(components, rows);
    if (mode === "setup_link") {
      const res = await run(
        () =>
          createClientSetupAction({
            clientName: options.ownerName ?? tenant.name,
            clientEmail: options.ownerEmail!,
            tenantName: tenant.name,
            tenantId: tenant.id,
            sendEmailToClient: sendEmail,
            products: [
              {
                productId: product.id,
                billFromMonth: billFrom || undefined,
                items: items.map((i) => ({
                  componentId: i.componentId,
                  priceCents: i.amountCents,
                  quantity: i.quantity,
                  settlement: i.settlement,
                })),
              },
            ],
          }),
        {
          key: "start",
          success: (r) => (sendEmail && !r.emailError ? `Setup link emailed to ${options.ownerEmail}` : "Setup link ready — copy it below"),
        },
      );
      if (!res?.ok) return;
      if (res.emailError) toast.warning(`${res.emailError} — send the link yourself.`);
      await navigator.clipboard.writeText(res.link).catch(() => {});
      setCreated({ link: res.link, emailed: sendEmail && !res.emailError });
      return;
    }
    const res = await run(
      () =>
        opsStartSubscriptionAction({
          tenantId: tenant.id,
          productId: product.id,
          items,
          collection: mode === "start_now" ? { mode: "send_invoice", daysUntilDue: days } : { mode: "charge_card_now" },
          billFromMonth: billFrom || undefined,
          skipTrial,
          persistOverrides: saveAsCustom,
        }),
      {
        key: "start",
        success: (r) => {
          const first = r.firstInvoice ? formatCents(r.firstInvoice.amountDueCents) : null;
          const from = r.catchUp ? ` from ${formatMonth(billFrom)}` : "";
          const paid = r.offlineInvoice ? `; ${formatCents(r.offlineInvoice.amountCents)} recorded as paid` : "";
          if (mode === "start_now") {
            return `${product.name} started${from} — ${first ? `first invoice ${first} is open (Stripe emails it; link in the table)` : "nothing to invoice today"}${paid}`;
          }
          return `${product.name} started${from} — ${first ?? "the first invoice"} ${r.paymentStatus === "paid" ? "charged to the card on file" : "needs the client's confirmation (hosted link in the table)"}${paid}`;
        },
      },
    );
    if (!res?.ok) return;
    if (res.offlineInvoiceError) {
      toast.warning(
        `Subscription started, but the offline payment wasn't recorded: ${res.offlineInvoiceError}. Record it with New invoice → Already paid offline.`,
      );
    }
    onOpenChange(false);
  }

  if (created) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Setup link ready</DialogTitle>
            <DialogDescription>
              For {options.ownerEmail}. Valid 14 days, single use; the client adds a card on the welcome page and the
              subscription starts on payment.{created.emailed ? " Emailed." : " Not emailed — send it yourself."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={created.link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1"
              onClick={() => {
                navigator.clipboard.writeText(created.link);
                toast.success("Link copied");
              }}
            >
              <Copy className="size-3.5" /> Copy
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const today = monthKey();
  const dueLabel =
    mode === "setup_link" ? "Client pays on the link" : plan?.totals.trialApplied ? "Due on first invoice (after trial)" : "Due on first invoice";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start subscription — {tenant.name}</DialogTitle>
          <DialogDescription>Pick the product and the negotiated terms. Nothing moves until you confirm.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid gap-2">
            <div className={heading}>Product</div>
            {startable.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every product is already live for this client.</p>
            ) : (
              <Select value={productId} onValueChange={pickProduct}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a product" />
                </SelectTrigger>
                <SelectContent>
                  {startable.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {prior && (
              <p className="text-xs text-muted-foreground">
                Previous {product?.name} subscription {prior.status} · since {formatDate(prior.subscribedAt)} — this starts a fresh one.
              </p>
            )}
            {!options.stripeConfigured && <p className="text-xs text-destructive">Stripe isn&apos;t configured — nothing can be started.</p>}
          </div>

          {product && (
            <>
              <div className="grid gap-2">
                <div className={heading}>Items & prices</div>
                <ProductTermsEditor mode={mode === "setup_link" ? "setup_link" : "start"} components={components} rows={rows} onChange={setRows} />
              </div>

              <div className="grid gap-2">
                <div className={heading}>Billing start</div>
                <div className="flex flex-wrap items-center gap-3">
                  <Label htmlFor="start-bill-from" className="text-sm">
                    Bill from
                  </Label>
                  <Input id="start-bill-from" type="month" max={today} className="w-44" value={billFrom} onChange={(e) => setBillFrom(e.target.value)} />
                  {billFrom && (
                    <Button variant="ghost" size="sm" onClick={() => setBillFrom("")}>
                      Today instead
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave empty to start today. Set a past month to bill it retroactively: the first invoice itemizes each month from
                  then through this month, and renewals then run on the 1st.
                </p>
              </div>

              <div className="grid gap-2">
                <div className={heading}>How to collect</div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" className="mt-1" checked={mode === "start_now"} onChange={() => setMode("start_now")} />
                  <span>
                    <span className="text-heading">Start now — Stripe emails the invoice</span>
                    <span className="block text-xs text-muted-foreground">
                      Creates the subscription today with no card. Stripe emails {options.ownerEmail ?? "the billing contact"} an invoice for
                      what isn&apos;t already paid; record cash or check payments from the invoices table.
                    </span>
                    {mode === "start_now" && (
                      <span className="mt-1.5 flex items-center gap-2 text-xs">
                        <Label htmlFor="start-days">Days until due</Label>
                        <Input id="start-days" className="h-7 w-16 text-right text-xs" value={daysUntilDue} onChange={(e) => setDaysUntilDue(e.target.value)} />
                      </span>
                    )}
                  </span>
                </label>
                <label className={`flex items-start gap-2 text-sm ${options.cardOnFile ? "" : "opacity-60"}`}>
                  <input type="radio" className="mt-1" disabled={!options.cardOnFile} checked={mode === "charge_card_now"} onChange={() => setMode("charge_card_now")} />
                  <span>
                    <span className="text-heading">Start now — charge the card on file</span>
                    <span className="block text-xs text-muted-foreground">
                      {options.cardOnFile
                        ? "Charges the saved card for the first invoice now; renewals auto-charge."
                        : "No card on file — use Send setup link to collect one."}
                    </span>
                  </span>
                </label>
                <label className={`flex items-start gap-2 text-sm ${options.ownerEmail ? "" : "opacity-60"}`}>
                  <input type="radio" className="mt-1" disabled={!options.ownerEmail} checked={mode === "setup_link"} onChange={() => setMode("setup_link")} />
                  <span>
                    <span className="text-heading">Send setup link — client adds a card</span>
                    <span className="block text-xs text-muted-foreground">
                      Holds these terms on a setup link. The client pays on the welcome page and the card is saved for renewals;
                      offline-paid items show as paid there.
                    </span>
                    {mode === "setup_link" && (
                      <span className="mt-1.5 flex items-center gap-2 text-xs">
                        <Checkbox checked={sendEmail} onCheckedChange={(v) => setSendEmail(Boolean(v))} />
                        Email the link to {options.ownerEmail}
                      </span>
                    )}
                  </span>
                </label>
                {(product.trialDays ?? 0) > 0 && !backdated && mode !== "setup_link" && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={useTrial} onCheckedChange={(v) => setUseTrial(Boolean(v))} />
                    Start with the {product.trialDays}-day trial (first invoice after the trial)
                  </label>
                )}
              </div>

              <div className="grid gap-2">
                <div className={heading}>Custom pricing</div>
                {mode === "setup_link" ? (
                  <p className="text-xs text-muted-foreground">
                    Prices are held on the link and become this client&apos;s custom pricing when they pay.
                  </p>
                ) : (
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox className="mt-0.5" checked={saveAsCustom} onCheckedChange={(v) => setSaveAsCustom(Boolean(v))} />
                    <span>
                      Save these prices as this client&apos;s custom pricing
                      <span className="block text-xs text-muted-foreground">Future add-ons of this product use them. Uncheck for a one-off deal.</span>
                    </span>
                  </label>
                )}
              </div>

              {plan && (
                <div className="grid gap-1 rounded-lg border bg-secondary/40 px-3 py-2 text-sm">
                  {plan.backdate && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        Catch-up {monthRange(plan.backdate.months)} ({plan.backdate.months.length} month{plan.backdate.months.length === 1 ? "" : "s"})
                      </span>
                      <span className="tabular-nums text-heading">{formatCents(plan.backdate.cents)}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{dueLabel}</span>
                    <span className="tabular-nums font-semibold text-heading">{formatCents(plan.totals.firstInvoiceCents)}</span>
                  </div>
                  {plan.totals.offlineCents > 0 && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Recorded as paid offline</span>
                      <span className="tabular-nums text-heading">{formatCents(plan.totals.offlineCents)}</span>
                    </div>
                  )}
                  {plan.totals.waivedListCents > 0 && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Waived (list value)</span>
                      <span className="tabular-nums text-muted-foreground">{formatCents(plan.totals.waivedListCents)}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    then {recurringLabel(plan)}
                    {plan.backdate ? ` from ${formatDate(plan.backdate.anchorAt)}` : ""}
                  </p>
                </div>
              )}
              {errors.length > 0 && (
                <ul className="text-xs text-destructive">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending
              ? mode === "setup_link"
                ? "Creating…"
                : "Starting…"
              : mode === "setup_link"
                ? "Create setup link"
                : mode === "charge_card_now"
                  ? `Charge ${formatCents(plan?.totals.firstInvoiceCents ?? 0)} & start`
                  : "Start subscription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
