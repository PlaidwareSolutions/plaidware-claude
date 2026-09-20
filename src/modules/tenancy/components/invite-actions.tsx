"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { AUTH, TENANT, withQuery } from "@/lib/routes";
import { Button } from "@/components/ui/button";

const ACCEPT_ERRORS: Record<string, string> = {
  INVITATION_NOT_FOUND: "This invitation has expired or was withdrawn.",
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: "This invitation was sent to a different address.",
  EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION: "Verify your email first, then come back to this link.",
};

/** Accepts the invitation for the signed-in user; the server page re-derives the state on failure. */
export function AcceptInvitationButton({ invitationId, organizationName }: { invitationId: string; organizationName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    const { error } = await authClient.organization.acceptInvitation({ invitationId });
    setBusy(false);
    if (error) {
      toast.error((error.code && ACCEPT_ERRORS[error.code]) ?? error.message ?? "This invitation is no longer valid");
      router.refresh();
      return;
    }
    toast.success(`Welcome to ${organizationName}`);
    router.push(TENANT.dashboard);
    router.refresh();
  }

  return (
    <Button onClick={accept} disabled={busy}>
      {busy ? "Joining…" : "Accept invitation"}
    </Button>
  );
}

/** Signs the current account out and returns to login prefilled with the invited address. */
export function SwitchAccountButton({ email, redirect }: { email: string; redirect: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signOut();
        router.push(withQuery(AUTH.login, { redirect, email }));
        router.refresh();
      }}
    >
      {busy ? "Signing out…" : `Sign out and continue as ${email}`}
    </Button>
  );
}
