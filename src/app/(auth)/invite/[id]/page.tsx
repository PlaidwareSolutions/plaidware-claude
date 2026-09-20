import Link from "next/link";
import { getSession } from "@/policy";
import { getInvitationPreview } from "@/modules/tenancy/queries";
import { inviteState } from "@/modules/tenancy/invite-state";
import { AcceptInvitationButton, SwitchAccountButton } from "@/modules/tenancy/components/invite-actions";
import { TENANT_ROLE_META, isTenantRole } from "@/lib/roles";
import { AUTH, withQuery } from "@/lib/routes";
import { formatDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Invitation" };
export const dynamic = "force-dynamic";

const roleLabel = (r: string | null) => (r && isTenantRole(r) ? TENANT_ROLE_META[r].label : (r ?? "member"));

/** The invitation link: shows who invited you where, and exactly one next step. */
export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [preview, session] = await Promise.all([getInvitationPreview(id), getSession()]);
  if (!preview) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="text-xl font-semibold text-heading">Invitation not found</h1>
        <p className="text-sm text-muted-foreground">This link doesn&apos;t match an invitation. Ask the person who invited you for a new one.</p>
        <Button asChild variant="outline"><Link href={AUTH.login}>Sign in</Link></Button>
      </div>
    );
  }

  const redirect = AUTH.invite(id);
  const state = inviteState({
    status: preview.status,
    expiresAt: preview.expiresAt,
    invitedEmail: preview.email,
    sessionEmail: session?.user.email ?? null,
    sessionEmailVerified: session?.user.emailVerified,
  });
  const intro = (
    <p className="text-sm text-muted-foreground">
      {preview.inviterName ?? "A workspace admin"} invited <strong className="text-heading">{preview.email}</strong> to join{" "}
      <strong className="text-heading">{preview.organizationName}</strong> as {roleLabel(preview.role)}.
    </p>
  );

  switch (state) {
    case "handled":
      return (
        <div className="flex flex-col gap-4 text-center">
          <h1 className="text-xl font-semibold text-heading">This invitation was already used</h1>
          <p className="text-sm text-muted-foreground">
            It was {preview.status === "accepted" ? "accepted" : "withdrawn"}. If you expected to join {preview.organizationName}, ask for a new invitation.
          </p>
          <Button asChild variant="outline"><Link href={AUTH.login}>Sign in</Link></Button>
        </div>
      );
    case "expired":
      return (
        <div className="flex flex-col gap-4 text-center">
          <h1 className="text-xl font-semibold text-heading">This invitation expired</h1>
          <p className="text-sm text-muted-foreground">
            It stopped working on {formatDate(preview.expiresAt)}. Ask {preview.inviterName ?? "the workspace admin"} to send a new one.
          </p>
        </div>
      );
    case "signed_out":
      return (
        <div className="flex flex-col gap-4 text-center">
          <h1 className="text-xl font-semibold text-heading">You&apos;re invited</h1>
          {intro}
          <div className="flex flex-col gap-2">
            <Button asChild>
              <Link href={withQuery(AUTH.login, { redirect, email: preview.email })}>Sign in as {preview.email}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={withQuery(AUTH.signup, { redirect, email: preview.email })}>Create an account for {preview.email}</Link>
            </Button>
          </div>
        </div>
      );
    case "mismatch":
      return (
        <div className="flex flex-col gap-4 text-center">
          <h1 className="text-xl font-semibold text-heading">Wrong account for this invitation</h1>
          {intro}
          <p className="text-sm text-muted-foreground">
            You&apos;re signed in as <strong className="text-heading">{session?.user.email}</strong>. Invitations can only be accepted by the address they were sent to.
          </p>
          <SwitchAccountButton email={preview.email} redirect={redirect} />
        </div>
      );
    case "unverified":
      return (
        <div className="flex flex-col gap-4 text-center">
          <h1 className="text-xl font-semibold text-heading">Verify your email first</h1>
          {intro}
          <Button asChild>
            <Link href={withQuery(AUTH.checkEmail, { email: preview.email, redirect })}>Resend the verification email</Link>
          </Button>
        </div>
      );
    case "ready":
      return (
        <div className="flex flex-col gap-4 text-center">
          <h1 className="text-xl font-semibold text-heading">Join {preview.organizationName}</h1>
          {intro}
          <AcceptInvitationButton invitationId={id} organizationName={preview.organizationName} />
        </div>
      );
  }
}
