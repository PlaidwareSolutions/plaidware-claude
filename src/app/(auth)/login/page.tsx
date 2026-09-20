"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { resolveRedirect } from "@/lib/safe-redirect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUTH, withQuery } from "@/lib/routes";
import { ACCOUNT_DISABLED_CODE, ACCOUNT_DISABLED_MESSAGE } from "@/lib/account-status";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Sanitized: same-app paths, or https *.plaidware.com (MHub hand-off).
  const dest = resolveRedirect(params.get("redirect"));
  const redirect = dest.url;
  const [email, setEmail] = useState(params.get("email")?.trim().toLowerCase() ?? "");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic-link">("password");
  const [linkSent, setLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(
    // The magic-link verify endpoint bounces failures back here with ?error=.
    params.get("error") === ACCOUNT_DISABLED_CODE
      ? ACCOUNT_DISABLED_MESSAGE
      : params.get("error")
        ? "That sign-in link is invalid or has expired. Request a new one below."
        : null,
  );
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (mode === "magic-link") {
      const { error } = await authClient.signIn.magicLink({
        email,
        callbackURL: redirect,
        errorCallbackURL: withQuery(AUTH.login, { error: "magic-link" }),
      });
      setBusy(false);
      if (error) {
        setError(error.message ?? "Could not send the sign-in link");
        return;
      }
      setLinkSent(true);
      return;
    }
    const { error } = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (error) {
      if (error.code === "EMAIL_NOT_VERIFIED") {
        router.push(withQuery(AUTH.checkEmail, { email, redirect: params.get("redirect") }));
        return;
      }
      setError(error.code === ACCOUNT_DISABLED_CODE ? ACCOUNT_DISABLED_MESSAGE : (error.message ?? "Sign in failed"));
      return;
    }
    if (dest.external) {
      // router.push is for in-app routes; cross-subdomain needs a full navigation.
      window.location.assign(redirect);
      return;
    }
    router.push(redirect);
    router.refresh();
  }

  if (linkSent) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-heading">Check your email</h1>
        <p className="text-sm text-muted-foreground">
          If an account exists for <strong>{email}</strong>, a sign-in link is on its way. It
          expires in 5 minutes and can be used once.
        </p>
        <Button variant="outline" onClick={() => setLinkSent(false)}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-heading">Sign in</h1>
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {mode === "password" && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href={AUTH.forgotPassword} className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? "Working…" : mode === "password" ? "Sign in" : "Email me a sign-in link"}
      </Button>
      <button
        type="button"
        className="text-sm text-primary hover:underline"
        onClick={() => {
          setMode(mode === "password" ? "magic-link" : "password");
          setError(null);
        }}
      >
        {mode === "password" ? "Email me a sign-in link instead" : "Use a password instead"}
      </button>
      <p className="text-center text-sm text-muted-foreground">
        New to Plaidware?{" "}
        <Link href={withQuery(AUTH.signup, { redirect, email: email || undefined })} className="text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
