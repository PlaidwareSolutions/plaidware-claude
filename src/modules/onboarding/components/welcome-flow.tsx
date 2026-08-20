"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
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
    subscriptionId: string;
  } | null>(null);
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );

  const signedInCorrectly =
    session?.user.email.toLowerCase() === proposal.clientEmail.toLowerCase();

  if (proposal.status === "accepted") {
    return (
      <div className="flex w-full max-w-md flex-col gap-3 text-center">
        <CheckCircle2 className="mx-auto size-10 text-success" />
        <h1 className="text-xl font-semibold text-heading">Setup already completed</h1>
        <p className="text-sm text-muted-foreground">
          Your services are active. Sign in anytime to see billing and status.
        </p>
        <Button asChild>
          <Link href="/login">Sign in</Link>
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
      productId: proposal.productId,
      componentIds: proposal.componentIds,
      tenantId: proposal.tenantId,
      skipAutoPromos: true, // the quoted price is the final price
    });
    if (!res.ok) {
      setBusy(false);
      toast.error(res.error);
      return;
    }
    // Mark accepted + attach the pre-configured domain right away.
    await finalizeSetupAction(token, res.subscriptionId);
    setBusy(false);
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
    <div className="flex w-full max-w-md flex-col gap-5">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-heading">
          Welcome, {proposal.clientName.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your {proposal.productName} setup for {proposal.tenantName} is ready.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your plan</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {proposal.lines.map((l) => (
            <div key={l.name} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{l.name}</span>
              <span className="tabular-nums text-heading">
                {formatCents(l.amountCents)}
                <span className="text-xs text-muted-foreground"> {l.oneTime ? "one-time" : l.cadence}</span>
              </span>
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
        </CardContent>
      </Card>

      {isPending ? null : payment && stripePromise ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {payment.mode === "setup" ? "Save your payment method" : "Payment"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Elements stripe={stripePromise} options={{ clientSecret: payment.clientSecret }}>
              <PaymentForm mode={payment.mode} subscriptionId={payment.subscriptionId} />
            </Elements>
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
