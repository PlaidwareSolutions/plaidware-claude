"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { resolveRedirect } from "@/lib/safe-redirect";
import { Button } from "@/components/ui/button";

function CheckEmail() {
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  // The verification link returns wherever signup was headed (an invitation, say) — not always the dashboard.
  const callbackURL = resolveRedirect(params.get("redirect")).url;
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function resend() {
    if (!email) return;
    setBusy(true);
    await authClient.sendVerificationEmail({ email, callbackURL });
    setBusy(false);
    setSent(true);
  }

  return (
    <div className="flex flex-col gap-4 text-center">
      <h1 className="text-xl font-semibold text-heading">Check your email</h1>
      <p className="text-sm text-muted-foreground">
        We sent a confirmation link{email ? ` to ${email}` : ""}. Click it to
        activate your account — the link is valid for 24 hours.
      </p>
      {email && (
        <Button variant="outline" onClick={resend} disabled={busy || sent}>
          {sent ? "Sent — check your inbox" : busy ? "Sending…" : "Resend email"}
        </Button>
      )}
    </div>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense>
      <CheckEmail />
    </Suspense>
  );
}
