"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { toast } from "sonner";
import type { ProductDto } from "@/modules/catalog/queries";
import { createCheckoutAction } from "../actions";
import { formatCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

const KIND_LABEL: Record<string, string> = {
  one_time: "one-time",
  recurring_monthly: "/mo",
  recurring_yearly: "/yr",
};

export function CheckoutFlow({
  product,
  publishableKey,
}: {
  product: ProductDto;
  publishableKey: string;
}) {
  const [optional, setOptional] = useState<Set<string>>(new Set());
  const [payment, setPayment] = useState<{
    clientSecret: string;
    mode: "payment" | "setup";
    subscriptionId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );

  const required = product.components.filter((c) => c.isRequired);
  const optionals = product.components.filter(
    (c) => !c.isRequired && c.kind !== "metered",
  );
  const selected = [
    ...required,
    ...optionals.filter((c) => optional.has(c.id)),
  ];
  const dueTodayCents = selected
    .filter((c) => c.kind === "one_time")
    .reduce((s, c) => s + c.amountCents, 0);
  const monthlyCents = selected
    .filter((c) => c.kind === "recurring_monthly")
    .reduce((s, c) => s + c.amountCents, 0);
  const yearlyCents = selected
    .filter((c) => c.kind === "recurring_yearly")
    .reduce((s, c) => s + c.amountCents, 0);

  async function begin() {
    setBusy(true);
    const res = await createCheckoutAction({
      productId: product.id,
      componentIds: [...optional],
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (res.clientSecret && res.mode !== "none") {
      setPayment({
        clientSecret: res.clientSecret,
        mode: res.mode,
        subscriptionId: res.subscriptionId,
      });
    } else {
      window.location.href = `/checkout/complete?subscription=${res.subscriptionId}`;
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold text-heading">
            Subscribe to {product.name}
          </h1>
          <p className="text-sm text-muted-foreground">{product.tagline}</p>
        </div>

        {!payment ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Build your bundle</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {required.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 rounded-md border bg-secondary/40 p-3">
                  <div>
                    <div className="text-sm font-medium text-heading">{c.name}</div>
                    {c.description && (
                      <div className="text-xs text-muted-foreground">{c.description}</div>
                    )}
                    <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-coral">
                      Required
                    </div>
                  </div>
                  <div className="whitespace-nowrap text-sm font-semibold tabular-nums text-heading">
                    {formatCents(c.amountCents)}
                    <span className="text-xs font-normal text-muted-foreground"> {KIND_LABEL[c.kind]}</span>
                  </div>
                </div>
              ))}
              {optionals.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-start justify-between gap-3 rounded-md border p-3 transition-colors hover:bg-accent/50">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={optional.has(c.id)}
                      onCheckedChange={(v) => {
                        setOptional((prev) => {
                          const next = new Set(prev);
                          if (v) next.add(c.id);
                          else next.delete(c.id);
                          return next;
                        });
                      }}
                    />
                    <div>
                      <div className="text-sm font-medium text-heading">{c.name}</div>
                      {c.description && (
                        <div className="text-xs text-muted-foreground">{c.description}</div>
                      )}
                    </div>
                  </div>
                  <div className="whitespace-nowrap text-sm font-semibold tabular-nums text-heading">
                    {formatCents(c.amountCents)}
                    <span className="text-xs font-normal text-muted-foreground"> {KIND_LABEL[c.kind]}</span>
                  </div>
                </label>
              ))}
            </CardContent>
          </Card>
        ) : stripePromise ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {payment.mode === "setup"
                  ? "Save your payment method"
                  : "Payment details"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Elements
                stripe={stripePromise}
                options={{ clientSecret: payment.clientSecret }}
              >
                <PaymentForm
                  mode={payment.mode}
                  subscriptionId={payment.subscriptionId}
                />
              </Elements>
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-destructive">Payments are not configured.</p>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Order summary</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {selected.map((c) => (
            <div key={c.id} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{c.name}</span>
              <span className="tabular-nums">{formatCents(c.amountCents)}{KIND_LABEL[c.kind] !== "one-time" ? KIND_LABEL[c.kind] : ""}</span>
            </div>
          ))}
          <div className="mt-2 border-t pt-2">
            {monthlyCents > 0 && (
              <div className="flex justify-between font-medium">
                <span>Monthly</span>
                <span className="tabular-nums">{formatCents(monthlyCents)}/mo</span>
              </div>
            )}
            {yearlyCents > 0 && (
              <div className="flex justify-between font-medium">
                <span>Yearly</span>
                <span className="tabular-nums">{formatCents(yearlyCents)}/yr</span>
              </div>
            )}
            <div className="flex justify-between text-base font-semibold text-heading">
              <span>Due today</span>
              <span className="tabular-nums">{formatCents(dueTodayCents + monthlyCents + yearlyCents)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Recurring charges renew automatically. Cancel anytime.
            </p>
          </div>
          {!payment && (
            <Button className="mt-3" onClick={begin} disabled={busy}>
              {busy ? "Preparing…" : "Continue to payment"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PaymentForm({
  mode,
  subscriptionId,
}: {
  mode: "payment" | "setup";
  subscriptionId: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    const returnUrl = `${window.location.origin}/checkout/complete?subscription=${subscriptionId}`;
    const confirm =
      mode === "setup"
        ? stripe.confirmSetup({ elements, confirmParams: { return_url: returnUrl } })
        : stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl } });
    const { error } = await confirm;
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Payment failed");
      return;
    }
    router.push(`/checkout/complete?subscription=${subscriptionId}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PaymentElement />
      <Button type="submit" disabled={busy || !stripe}>
        {busy ? "Processing…" : mode === "setup" ? "Start free trial" : "Pay now"}
      </Button>
    </form>
  );
}
