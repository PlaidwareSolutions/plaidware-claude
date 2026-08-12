"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export default function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    const { error } = await authClient.organization.acceptInvitation({
      invitationId: id,
    });
    setBusy(false);
    if (error) {
      setError(error.message ?? "This invitation is no longer valid");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  if (isPending) {
    return <p className="text-center text-sm text-muted-foreground">Loading…</p>;
  }

  if (!session) {
    const back = encodeURIComponent(`/invite/${id}`);
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="text-xl font-semibold text-heading">You&apos;re invited</h1>
        <p className="text-sm text-muted-foreground">
          Sign in or create an account with the invited email address to join
          this workspace.
        </p>
        <div className="flex flex-col gap-2">
          <Button asChild>
            <Link href={`/login?redirect=${back}`}>Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/signup?redirect=${back}`}>Create account</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 text-center">
      <h1 className="text-xl font-semibold text-heading">Join workspace</h1>
      <p className="text-sm text-muted-foreground">
        Accept this invitation as {session.user.email}. If the invite was sent
        to a different address, sign in with that account instead.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={accept} disabled={busy}>
        {busy ? "Joining…" : "Accept invitation"}
      </Button>
    </div>
  );
}
