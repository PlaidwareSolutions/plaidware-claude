"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { SetupProposal } from "../service";
import { completeSetupPasswordAction, finalizeSetupAction } from "../actions";
import { createCheckoutAction } from "@/modules/billing/actions";
import { PaymentForm } from "@/modules/billing/components/checkout-flow";
import { authClient, useSession } from "@/lib/auth-client";
import { formatCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RecoveryItem = {
  productId: string;
  productName: string;
  status: "requires_action" | "requires_payment";
  clientSecret: string;
};

export function WelcomeFlow({
  token,
  proposal,
  publishableKey,
}: {
  token: string;
  proposal: SetupProposal;
  publishableKey: string;
}) {
  const { data: session, isPending } = useSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [signInPw, setSignInPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState<{
    clientSecret: string;
    mode: "payment" | "setup";
  } | null>(null);
  const [phase, setPhase] = useState<"idle" | "finishing" | "waiting" | "done">("idle");
  const [recovery, setRecovery] = useState<RecoveryItem | null>(null);
  const settling = useRef(false);
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );

  const signedInCorrectly =
    session?.user.email.toLowerCase() === proposal.clientEmail.toLowerCase();

  const primary = proposal.products[proposal.primaryIndex];
  const others = proposal.products.filter((_, i) => i !== proposal.primaryIndex);
  const othersDueCents = others.reduce((s, p) => s + p.dueTodayCents, 0);
  const productNames = proposal.products.map((p) => p.productName).join(" + ");
  const welcomeReturnUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/welcome/${token}?paid=1`
      : undefined;

  /** Drive the server-side fan-out until every product is live. */
  async function settle(silent = false) {
    if (settling.current) return;
    settling.current = true;
    if (!silent) setPhase("finishing");
    setRecovery(null);
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await finalizeSetupAction(token);
        if (!res.ok) {
          if (!silent) toast.error(res.error);
          setPhase("idle");
          return;
        }
        if (res.state === "complete") {
          setPhase("done");
          return;
        }
        if (res.state === "awaiting_primary") {
          setPhase("idle");
          return;
        }
        if (res.state === "awaiting_payment") {
          setPhase("finishing");
          await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
          continue;
        }
        // Secondary charge needs the client's help.
        const item = res.items[0];
        if (item.status === "requires_action" && stripePromise) {
          setPhase("finishing");
          const stripe = await stripePromise;
          if (stripe) {
            const { error } = await stripe.handleNextAction({ clientSecret: item.clientSecret });
            if (!error) continue; // authenticated — re-run the fan-out
          }
        }
        setRecovery(item);
        setPhase("idle");
        return;
      }
      setPhase("waiting"); // webhook backstop finishes it
    } finally {
      settling.current = false;
    }
  }

  // Resume on every visit while signed in: covers the 3DS redirect return
  // (?paid=1) and any revisit after a partial run — runFinalize is idempotent.
  useEffect(() => {
    if (!(signedInCorrectly && proposal.status === "pending")) return;
    const t = setTimeout(() => void settle(true), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedInCorrectly]);

  if (proposal.status === "accepted" || phase === "done") {
    return (
      <div className="flex w-full max-w-md flex-col gap-3 text-center">
        <CheckCircle2 className="mx-auto size-10 text-success" />
        <h1 className="text-xl font-semibold text-heading">
          {phase === "done" ? "You're all set!" : "Setup already completed"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {phase === "done"
            ? `${productNames} ${proposal.products.length > 1 ? "are" : "is"} active for ${proposal.tenantName}.`
            : "Your services are active. Sign in anytime to see billing and status."}
        </p>
        <Button asChild>
          <Link href={phase === "done" ? "/dashboard" : "/login"}>
            {phase === "done" ? "Open your dashboard" : "Sign in"}
          </Link>
        </Button>
      </div>
    );
  }
  if (proposal.status !== "pending") {
    return (
      <div className="flex w-full max-w-md flex-col gap-3 text-center">
        <h1 className="text-xl font-semibold text-heading">Link expired</h1>
        <p className="text-sm text-muted-foreground">
          This setup link is no longer active. Ask your Plaidware contact for a
          fresh one — your configuration is saved.
        </p>
      </div>
    );
  }

  async function setPasswordAndSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setBusy(true);
    const res = await completeSetupPasswordAction(token, password);
    if (!res.ok) {
      setBusy(false);
      toast.error(res.error ?? "Password setup failed");
      return;
    }
    const { error } = await authClient.signIn.email({
      email: proposal.clientEmail,
      password,
    });
    setBusy(false);
    if (error) toast.error(error.message ?? "Sign-in failed");
  }

  async function signInExisting(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await authClient.signIn.email({
      email: proposal.clientEmail,
      password: signInPw,
    });
    setBusy(false);
    if (error) toast.error(error.message ?? "Sign-in failed");
  }

  async function startPayment() {
    setBusy(true);
    const res = await createCheckoutAction({
      productId: primary.productId,
      componentIds: primary.componentIds,
      tenantId: proposal.tenantId,
      skipAutoPromos: true, // the quoted price is the final price
    });
    setBusy(false);
    if (!res.ok) {
      // Revisit after the primary was already paid — just resume the fan-out.
      if (/already have an active/i.test(res.error)) {
        void settle();
        return;
      }
      toast.error(res.error);
      return;
    }
    if (res.clientSecret && res.mode !== "none") {
      setPayment({ clientSecret: res.clientSecret, mode: res.mode });
    } else {
      void settle();
    }
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-5">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-heading">
          Welcome, {proposal.clientName.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your {productNames} setup for {proposal.tenantName} is ready.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your plan</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {proposal.products.map((p) => (
            <div key={p.productId} className="flex flex-col gap-1.5">
              {proposal.products.length > 1 && (
                <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-primary">
                  {p.productName}
                </div>
              )}
              {p.lines.map((l) => (
                <div key={l.name} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{l.name}</span>
                  <span className="tabular-nums text-heading">
                    {formatCents(l.amountCents)}
                    <span className="text-xs text-muted-foreground"> {l.oneTime ? "one-time" : l.cadence}</span>
                  </span>
                </div>
              ))}
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold text-heading">
            <span>Due today</span>
            <span className="tabular-nums">{formatCents(proposal.dueTodayCents)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {proposal.monthlyCents > 0 && `Then ${formatCents(proposal.monthlyCents)}/mo`}
            {proposal.monthlyCents > 0 && proposal.yearlyCents > 0 && " + "}
            {proposal.yearlyCents > 0 && `${formatCents(proposal.yearlyCents)}/yr`}
            {(proposal.monthlyCents > 0 || proposal.yearlyCents > 0) &&
              ", charged automatically with an emailed notice before each renewal."}
          </p>
          {proposal.products.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Your card will be charged separately for each service —{" "}
              {proposal.products.length} charges totaling {formatCents(proposal.dueTodayCents)}{" "}
              today.
            </p>
          )}
        </CardContent>
      </Card>

      {isPending ? null : phase === "finishing" || phase === "waiting" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 pt-6 text-center text-sm">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-muted-foreground">
              {phase === "waiting"
                ? "Payment is still confirming — this page will finish automatically. If nothing changes in a minute, refresh."
                : proposal.products.length > 1
                  ? "Payment received — activating your remaining services…"
                  : "Finishing your setup…"}
            </p>
            {phase === "waiting" && (
              <Button variant="outline" onClick={() => void settle()}>
                Check again
              </Button>
            )}
          </CardContent>
        </Card>
      ) : recovery && stripePromise ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Confirm payment — {recovery.productName}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              We couldn&apos;t charge your saved card for {recovery.productName}. Please
              confirm this payment to finish your setup.
            </p>
            <Elements stripe={stripePromise} options={{ clientSecret: recovery.clientSecret }}>
              <PaymentForm
                mode="payment"
                returnUrl={welcomeReturnUrl}
                onSuccess={() => void settle()}
              />
            </Elements>
          </CardContent>
        </Card>
      ) : payment && stripePromise ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {payment.mode === "setup"
                ? "Save your payment method"
                : proposal.products.length > 1
                  ? `Payment — ${primary.productName}`
                  : "Payment"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Elements stripe={stripePromise} options={{ clientSecret: payment.clientSecret }}>
              <PaymentForm
                mode={payment.mode}
                returnUrl={welcomeReturnUrl}
                onSuccess={() => void settle()}
              />
            </Elements>
            {others.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Paying {formatCents(primary.dueTodayCents)} for {primary.productName} now;{" "}
                {others.map((p) => p.productName).join(", ")} ({formatCents(othersDueCents)})
                will be charged to the same card immediately after.
              </p>
            )}
          </CardContent>
        </Card>
      ) : signedInCorrectly ? (
        <Button size="lg" onClick={startPayment} disabled={busy}>
          {busy ? "Preparing…" : `Continue to payment — ${formatCents(proposal.dueTodayCents)}`}
        </Button>
      ) : session ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6 text-center text-sm">
            <p className="text-muted-foreground">
              You&apos;re signed in as {session.user.email}, but this setup is for{" "}
              {proposal.clientEmail}.
            </p>
            <Button
              variant="outline"
              onClick={async () => {
                await authClient.signOut();
                window.location.reload();
              }}
            >
              Switch account
            </Button>
          </CardContent>
        </Card>
      ) : proposal.needsPassword ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Choose your password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={setPasswordAndSignIn} className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                Account: <span className="font-mono">{proposal.clientEmail}</span>
              </p>
              <div className="grid gap-1.5">
                <Label htmlFor="pw">Password (8+ characters)</Label>
                <Input id="pw" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pw2">Confirm password</Label>
                <Input id="pw2" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <Button type="submit" disabled={busy || !password}>
                {busy ? "Setting up…" : "Set password & continue"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sign in to continue</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={signInExisting} className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                Account: <span className="font-mono">{proposal.clientEmail}</span>
              </p>
              <div className="grid gap-1.5">
                <Label htmlFor="spw">Password</Label>
                <Input id="spw" type="password" autoComplete="current-password" required value={signInPw} onChange={(e) => setSignInPw(e.target.value)} />
              </div>
              <Button type="submit" disabled={busy || !signInPw}>
                {busy ? "Signing in…" : "Sign in & continue"}
              </Button>
              <Link href="/forgot-password" className="text-center text-xs text-primary hover:underline">
                Forgot password?
              </Link>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
