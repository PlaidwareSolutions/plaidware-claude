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
  const { run, isPending } = useAction();
  const confirm = useConfirm();
  const [fresh, setFresh] = useState<{ link: string; sentTo: string | null; invite: Row } | null>(null);

  async function regenerate(inv: Row, emailClient: boolean) {
    const res = await run(() => regenerateSetupLinkAction(inv.id, { emailClient }), {
      key: `regen:${inv.id}`,
      success: (r) => (r.sentTo ? `New link emailed to ${r.sentTo}` : "New setup link ready"),
    });
    if (res?.ok) {
      if (res.emailError) toast.warning(res.emailError);
      setFresh({ link: res.link, sentTo: res.sentTo, invite: inv });
    }
  }

  async function resend(inv: Row) {
    await run(() => resendSetupLinkAction(inv.id), {
      key: `resend:${inv.id}`,
      success: (r) => `Link re-sent to ${r.sentTo}`,
    });
  }

  async function revoke(inv: Row) {
    const ok = await confirm({
      title: `Revoke the setup link for ${inv.clientEmail}?`,
      description: "The link stops working immediately and any prices held for it are cleared. You can regenerate a new one later.",
      confirmLabel: "Revoke link",
      destructive: true,
    });
    if (!ok) return;
    void run(() => revokeSetupAction(inv.id), { key: `revoke:${inv.id}`, success: "Setup link revoked" });
  }

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
                {status !== "accepted" && (
                  <div className="flex flex-wrap gap-1">
                    {open ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          disabled={!inv.hasStoredToken || isPending(`resend:${inv.id}`)}
                          title={inv.hasStoredToken ? "Email the same link again" : "Created before resend support — use New link"}
                          onClick={() => void resend(inv)}
                        >
                          <Mail className="size-3.5" /> Resend
                        </Button>
                        <Button size="sm" variant="ghost" className="gap-1" disabled={isPending(`regen:${inv.id}`)} onClick={() => void regenerate(inv, false)}>
                          <RefreshCw className="size-3.5" /> New link
                        </Button>
                        <Button size="sm" variant="ghost" disabled={isPending(`revoke:${inv.id}`)} onClick={() => void revoke(inv)}>
                          Revoke
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" className="gap-1" disabled={isPending(`regen:${inv.id}`)} onClick={() => void regenerate(inv, false)}>
                          <RefreshCw className="size-3.5" /> Regenerate
                        </Button>
                        <Button size="sm" variant="ghost" className="gap-1" disabled={isPending(`regen:${inv.id}`)} onClick={() => void regenerate(inv, true)}>
                          <Mail className="size-3.5" /> Regenerate & email
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!fresh} onOpenChange={(o) => !o && setFresh(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Setup link ready</DialogTitle>
            <DialogDescription>
              For {fresh?.invite.clientEmail}. Valid 14 days, single use; the previous link no longer works.
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
    </Section>
  );
}
