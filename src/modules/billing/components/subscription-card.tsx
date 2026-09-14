"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CreditCard,
  ExternalLink,
  Mail,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  Receipt,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import type { AddonOption, SubscriptionAutomation, SubscriptionDto } from "../queries";
import {
  opsCancelSubscriptionAction,
  opsReactivateSubscriptionAction,
  opsSuspendSubscriptionAction,
  sendCardSetupLinkAction,
  switchToAutoChargeAction,
} from "../ar-actions";
import { intervalLabel, isRecurringKind } from "../mappers";
import { formatCents } from "@/lib/money";
import { formatDate, formatDay, formatMonth } from "@/lib/dates";
import { OPS, stripeSubscriptionUrl } from "@/lib/routes";
import { collectionKey } from "@/lib/status-variants";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HostingFeeDialog, type HostingTarget } from "./ops-billing-dialogs";
import { ManageAddonsDialog } from "./manage-addons-dialog";

const CLOSED = new Set(["canceled", "expired"]);

/**
 * One subscription as ops sees it: local status beside Stripe's, how the next
 * renewal collects, every item, the hosting fee, and the actions that change
 * any of it. Shared by the client Billing tab and (later) the Billing board.
 */
export function SubscriptionCard({
  tenant,
  sub,
  automation,
  addonOptions,
  stripeTestMode,
}: {
  tenant: { id: string; name: string };
  sub: SubscriptionDto;
  automation: SubscriptionAutomation | undefined;
  addonOptions: AddonOption[];
  stripeTestMode: boolean;
}) {
  const [hostingFor, setHostingFor] = useState<HostingTarget | null>(null);
  const [addonsOpen, setAddonsOpen] = useState(false);
  const live = !CLOSED.has(sub.status);
  const a = automation && !automation.error ? automation : undefined;
  const items = sub.items.filter((i) => i.status !== "canceled");
  const stripeDiffers = a?.stripeStatus && a.stripeStatus !== sub.status && a.stripeStatus.replace("_", " ") !== sub.status;

  return (
    <Card className="gap-4 py-5">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: sub.productColor ?? "var(--primary)" }} />
            <Link href={OPS.product(sub.productId)} className="font-medium text-heading hover:text-primary">
              {sub.productName}
            </Link>
            <StatusBadge kind="subscription" status={sub.status} />
            {stripeDiffers && (
              <Badge variant="outline" className="text-[10px]" title="Stripe's status differs from the Hub's — a Hub-side hold or a sync in flight">
                Stripe: {a!.stripeStatus!.replace("_", " ")}
              </Badge>
            )}
            {a?.cancelAtPeriodEnd && (
              <Badge variant="warning" className="text-[10px]">cancels {formatDay(a.nextChargeAt)}</Badge>
            )}
            {live && a && <StatusBadge kind="collection" status={collectionKey(a)} className="text-[10px]" />}
            {live && automation?.error && (
              <Badge variant="outline" className="text-[10px]" title={automation.error}>Stripe unavailable</Badge>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {sub.monthlyCents > 0 ? `${formatCents(sub.monthlyCents)}/mo` : "no recurring charge"}
            {a?.yearlyCents ? ` + ${formatCents(a.yearlyCents)}/yr` : ""}
            {live && (a?.nextChargeAt ?? sub.currentPeriodEnd)
              ? ` · next charge ${formatDate(a?.nextChargeAt ?? sub.currentPeriodEnd)}`
              : ""}
            {sub.status === "trialing" && sub.trialEndsAt ? ` · trial ends ${formatDate(sub.trialEndsAt)}` : ""}
            {" · since "}
            {formatDate(sub.subscribedAt)}
            {a && (a.cardOnFile ? " · card on file" : " · no card on file")}
          </div>
          {sub.status === "suspended" && (
            <p className="mt-1 text-xs text-destructive">
              {sub.suspensionSource === "manual" ? "Manual hold" : "Suspended by dunning"}
              {sub.suspendedAt ? ` since ${formatDate(sub.suspendedAt)}` : ""}
              {sub.suspensionNote ? ` — ${sub.suspensionNote}` : ""}
              {sub.suspensionSource === "manual" ? ". Stays until you reactivate." : ". Lifts when the invoice is paid."}
            </p>
          )}
        </div>
        {live && (
          <SubscriptionActionsMenu
            tenant={tenant}
            sub={sub}
            automation={automation}
            stripeTestMode={stripeTestMode}
            onHostingFee={() =>
              setHostingFor({
                id: sub.id,
                productName: sub.productName,
                monthlyHostingCents: sub.monthlyHostingCents,
                hostingBillingStartMonth: sub.hostingBillingStartMonth,
              })
            }
            onAddons={() => setAddonsOpen(true)}
          />
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5">
              <span className="truncate text-heading">{i.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatCents(i.amountCents)}
                <span className="text-xs"> {isRecurringKind(i.kind) ? intervalLabel(i) : "one-time"}</span>
                {i.status !== "active" && i.status !== "paid" && (
                  <StatusBadge kind="subscriptionItem" status={i.status} className="ml-1.5 text-[10px]" />
                )}
              </span>
            </li>
          ))}
          {items.length === 0 && <li className="text-muted-foreground">No items recorded.</li>}
        </ul>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Hosting fee:{" "}
            {sub.monthlyHostingCents ? (
              <span className="text-heading">
                {formatCents(sub.monthlyHostingCents)}/mo
                {sub.hostingBillingStartMonth ? ` from ${formatMonth(sub.hostingBillingStartMonth)}` : ""}
              </span>
            ) : (
              "none"
            )}
          </span>
          {sub.domainUrl && (
            <a href={sub.domainUrl} target="_blank" rel="noreferrer" className="hover:text-primary">
              {sub.domainUrl}
            </a>
          )}
        </div>
      </CardContent>

      <HostingFeeDialog key={hostingFor?.id ?? "none"} target={hostingFor} onOpenChange={(o) => !o && setHostingFor(null)} />
      <ManageAddonsDialog subscription={sub} options={addonOptions} open={addonsOpen} onOpenChange={setAddonsOpen} />
    </Card>
  );
}

export function SubscriptionActionsMenu({
  tenant,
  sub,
  automation,
  stripeTestMode,
  onHostingFee,
  onAddons,
}: {
  tenant: { id: string; name: string };
  sub: SubscriptionDto;
  automation: SubscriptionAutomation | undefined;
  stripeTestMode: boolean;
  onHostingFee: () => void;
  onAddons: () => void;
}) {
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const a = automation && !automation.error ? automation : undefined;

  async function sendCardLink() {
    const res = await run(() => sendCardSetupLinkAction(tenant.id), {
      key: `card:${sub.id}`,
      refresh: false,
      success: (r) => (r.sentTo ? `Card setup link emailed to ${r.sentTo} — also copied` : "Card setup link copied (no billing contact to email)"),
    });
    if (res?.ok) await navigator.clipboard.writeText(res.url).catch(() => {});
  }

  async function suspend() {
    const r = await confirm({
      title: `Suspend ${sub.productName} for ${tenant.name}?`,
      description: "A manual hold: the Hub marks the subscription suspended and MHub (if involved) is told. It survives payments and Stripe syncs until you reactivate it. Stripe keeps billing unless you also cancel.",
      confirmLabel: "Suspend",
      destructive: true,
      field: { label: "Reason (shown on the card and in Activity)", placeholder: "e.g. contract dispute" },
    });
    if (!r) return;
    void run(() => opsSuspendSubscriptionAction({ subscriptionId: sub.id, note: r.value }), {
      key: `hold:${sub.id}`,
      success: `${sub.productName} suspended`,
    });
  }

  async function reactivate() {
    const ok = await confirm({
      title: `Reactivate ${sub.productName}?`,
      description: sub.suspensionSource === "dunning"
        ? "This lifts a dunning hold without waiting for payment. The past-due invoice stays open."
        : "Clears the manual hold. Stripe's next sync re-derives the exact status.",
      confirmLabel: "Reactivate",
    });
    if (!ok) return;
    void run(() => opsReactivateSubscriptionAction(sub.id), { key: `hold:${sub.id}`, success: `${sub.productName} reactivated` });
  }

  async function cancel() {
    const ok = await confirm({
      title: `Cancel ${tenant.name}'s ${sub.productName}?`,
      description: "Billing stops immediately in Stripe and the Hub. One-time work already delivered is not refunded.",
      confirmLabel: "Cancel subscription",
      cancelLabel: "Keep it",
      destructive: true,
    });
    if (!ok) return;
    void run(() => opsCancelSubscriptionAction(sub.id), { key: `cancel:${sub.id}`, success: "Subscription canceled" });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="size-8 p-0" aria-label={`Actions for ${sub.productName}`} disabled={pending}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onAddons}>
          <SlidersHorizontal className="size-4" /> Manage add-ons…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onHostingFee}>
          <Receipt className="size-4" /> Hosting fee…
        </DropdownMenuItem>
        {a?.collectionMethod === "send_invoice" && a.cardOnFile && (
          <DropdownMenuItem onSelect={() => void run(() => switchToAutoChargeAction(sub.id), { key: `auto:${sub.id}`, success: "Renewals will now charge the card on file" })}>
            <CreditCard className="size-4" /> Switch to auto-charge
          </DropdownMenuItem>
        )}
        {a && !a.cardOnFile && (
          <DropdownMenuItem onSelect={() => void sendCardLink()}>
            <Mail className="size-4" /> Send card setup link
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {sub.status === "suspended" ? (
          <DropdownMenuItem onSelect={() => void reactivate()}>
            <PlayCircle className="size-4" /> Reactivate
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => void suspend()}>
            <PauseCircle className="size-4" /> Suspend…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onSelect={() => void cancel()}>
          <XCircle className="size-4" /> Cancel subscription…
        </DropdownMenuItem>
        {sub.stripeSubscriptionId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={stripeSubscriptionUrl(sub.stripeSubscriptionId, stripeTestMode)} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> Subscription in Stripe
              </a>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
