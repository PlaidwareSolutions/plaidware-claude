"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Copy, Link2, Mail, RefreshCw } from "lucide-react";
import type { TenantSetupInvite } from "../queries";
import { regenerateSetupLinkAction, resendSetupLinkAction, revokeSetupAction } from "../actions";
import { OPS } from "@/lib/routes";
import { formatDate, formatRelative } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Row = TenantSetupInvite & { tenantId?: string; tenantName?: string };

/** The link a row needs for its actions. */
export type SetupLinkRef = { id: string; clientEmail: string; hasStoredToken: boolean };

/**
 * Resend / New link / Revoke for one open setup link (Regenerate / Regenerate
 * & email for a dead one). Regenerating shows the new link exactly once, in
 * this component's own dialog. Shared by the Setup links card and the
 * pending-subscription card on the Billing tab.
 */
export function SetupLinkActions({ invite, status }: { invite: SetupLinkRef; status: string }) {
  const { run, isPending } = useAction();
  const confirm = useConfirm();
  const [fresh, setFresh] = useState<{ link: string; sentTo: string | null } | null>(null);
  const open = status === "pending";

  async function regenerate(emailClient: boolean) {
    const res = await run(() => regenerateSetupLinkAction(invite.id, { emailClient }), {
      key: `regen:${invite.id}`,
      success: (r) => (r.sentTo ? `New link emailed to ${r.sentTo}` : "New setup link ready"),
    });
    if (res?.ok) {
      if (res.emailError) toast.warning(res.emailError);
      setFresh({ link: res.link, sentTo: res.sentTo });
    }
  }

  async function resend() {
    await run(() => resendSetupLinkAction(invite.id), {
      key: `resend:${invite.id}`,
      success: (r) => `Link re-sent to ${r.sentTo}`,
    });
  }

  async function revoke() {
    const ok = await confirm({
      title: `Revoke the setup link for ${invite.clientEmail}?`,
      description: "The link stops working immediately and any prices held for it are cleared. You can regenerate a new one later.",
      confirmLabel: "Revoke link",
      destructive: true,
    });
    if (!ok) return;
    void run(() => revokeSetupAction(invite.id), { key: `revoke:${invite.id}`, success: "Setup link revoked" });
  }

  if (status === "accepted") return null;
  return (
    <>
      <div className="flex flex-wrap gap-1">
        {open ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              disabled={!invite.hasStoredToken || isPending(`resend:${invite.id}`)}
              title={invite.hasStoredToken ? "Email the same link again" : "Created before resend support — use New link"}
              onClick={() => void resend()}
            >
              <Mail className="size-3.5" /> Resend
            </Button>
            <Button size="sm" variant="ghost" className="gap-1" disabled={isPending(`regen:${invite.id}`)} onClick={() => void regenerate(false)}>
              <RefreshCw className="size-3.5" /> New link
            </Button>
            <Button size="sm" variant="ghost" disabled={isPending(`revoke:${invite.id}`)} onClick={() => void revoke()}>
              Revoke
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" className="gap-1" disabled={isPending(`regen:${invite.id}`)} onClick={() => void regenerate(false)}>
              <RefreshCw className="size-3.5" /> Regenerate
            </Button>
            <Button size="sm" variant="ghost" className="gap-1" disabled={isPending(`regen:${invite.id}`)} onClick={() => void regenerate(true)}>
              <Mail className="size-3.5" /> Regenerate & email
            </Button>
          </>
        )}
      </div>
      <Dialog open={!!fresh} onOpenChange={(o) => !o && setFresh(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Setup link ready</DialogTitle>
            <DialogDescription>
              For {invite.clientEmail}. Valid 14 days, single use; the previous link no longer works.
              {fresh?.sentTo ? ` Emailed to ${fresh.sentTo}.` : " Not emailed — send it yourself."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={fresh?.link ?? ""} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1"
              onClick={() => {
                if (!fresh) return;
                navigator.clipboard.writeText(fresh.link);
                toast.success("Link copied");
              }}
            >
              <Copy className="size-3.5" /> Copy
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setFresh(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Every setup link for a client (or, with `showTenant`, every open link on the
 * platform). Regenerate rotates the token and shows the new link exactly once.
 */
export function SetupLinksCard({
  invites,
  showTenant = false,
  compact = false,
}: {
  invites: Row[];
  showTenant?: boolean;
  compact?: boolean;
}) {
  const effective = (inv: Row) => (inv.status === "pending" && inv.isExpired ? "expired" : inv.status);
  const visible = compact ? invites.filter((i) => i.status !== "accepted") : invites;

  return (
    <Section
      title="Setup links"
      icon={Link2}
      count={invites.length}
      description="One-click onboarding links: password, payment, done. A lost link is re-sent as-is; an expired or revoked one is regenerated."
    >
      {visible.length === 0 ? (
        <EmptyState
          icon={Link2}
          title={compact ? "No open setup links" : "No setup links yet"}
          description={showTenant ? "Onboard a client to create one." : "This client was onboarded without a setup link, or every link has been used."}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((inv) => {
            const status = effective(inv);
            const open = status === "pending";
            return (
              <div key={inv.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
                <StatusBadge kind="invite" status={status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-heading">
                    {showTenant && inv.tenantId && (
                      <>
                        <Link href={OPS.client(inv.tenantId)} className="font-medium hover:text-primary">
                          {inv.tenantName}
                        </Link>
                        <span className="text-muted-foreground">·</span>
                      </>
                    )}
                    <span>{inv.clientName}</span>
                    <span className="text-muted-foreground">{inv.clientEmail}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {inv.productNames.join(" + ") || "no products"} · created {formatDate(inv.createdAt)}
                    {inv.createdByName ? ` by ${inv.createdByName}` : ""}
                    {open
                      ? ` · expires ${formatDate(inv.expiresAt)} (${formatRelative(inv.expiresAt)})`
                      : status === "expired"
                        ? ` · expired ${formatDate(inv.expiresAt)}`
                        : inv.acceptedAt
                          ? ` · completed ${formatDate(inv.acceptedAt)}`
                          : ""}
                  </div>
                </div>
                <SetupLinkActions invite={inv} status={status} />
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
