"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { PaymentForm } from "@/modules/billing/components/checkout-flow";
import { intervalLabel, isRecurringKind } from "@/modules/billing/mappers";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { AUTH } from "@/lib/routes";
import type { PayPageState } from "../api-service";

type Pay = Extract<PayPageState, { state: "pay" }>;

/**
 * No-login payment for a partner-app subscription: the plan summary and
 * Stripe's PaymentElement. Success (in-page or after a 3DS redirect) lands
 * on /pay/<token>/done, which sends the owner back to the partner app.
 */
export function PayFlow({ token, page, publishableKey }: { token: string; page: Pay; publishableKey: string }) {
  const router = useRouter();
  const stripePromise = useMemo(() => (publishableKey ? loadStripe(publishableKey) : null), [publishableKey]);
  const recurring = page.items.filter((i) => isRecurringKind(i.kind));
  const oneTime = page.items.filter((i) => !isRecurringKind(i.kind));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-heading">
          {page.mode === "setup" ? `Add a card for ${page.productName}` : `Pay for ${page.productName}`}
        </h1>
        <p className="text-sm text-muted-foreground">
          {page.orgName} · billed by Plaidware for {page.appName}
        </p>
      </div>

      <ul className="flex flex-col gap-1.5 text-sm">
        {[...recurring, ...oneTime].map((i, n) => (
          <li key={n} className="flex justify-between gap-3">
            <span>
              {i.name}
              {i.quantity > 1 && <span className="text-muted-foreground"> × {i.quantity}</span>}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {formatCents(i.amountCents * i.quantity)}
              {isRecurringKind(i.kind) ? intervalLabel(i) : " one-time"}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex justify-between border-t pt-3 text-sm font-medium">
        <span>Due now</span>
        <span className="tabular-nums">{formatCents(page.amountDueCents)}</span>
      </div>
      {page.mode === "setup" && page.trialEndsAt && (
        <p className="text-xs text-muted-foreground">
          Nothing is charged today. Your free trial runs until {formatDate(page.trialEndsAt)}; this card is charged then.
        </p>
      )}

      {stripePromise ? (
        <Elements stripe={stripePromise} options={{ clientSecret: page.clientSecret }}>
          <PaymentForm
            mode={page.mode}
            submitLabel={page.mode === "setup" ? "Save card" : "Pay now"}
            returnUrl={`${typeof window === "undefined" ? "" : window.location.origin}${AUTH.payDone(token)}`}
            onSuccess={() => router.push(AUTH.payDone(token))}
          />
        </Elements>
      ) : (
        <p className="text-sm text-destructive">Payments are not configured.</p>
      )}

      {page.cancelUrl && (
        <a href={page.cancelUrl} className="text-center text-sm text-muted-foreground hover:text-primary">
          Cancel and return to {page.appName}
        </a>
      )}
    </div>
  );
}
