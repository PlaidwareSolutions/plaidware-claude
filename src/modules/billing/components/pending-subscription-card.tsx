"use client";

import Link from "next/link";
import { Link2 } from "lucide-react";
import type { PendingSetupTerms } from "@/modules/onboarding/queries";
import { SetupLinkActions } from "@/modules/onboarding/components/setup-links-card";
import { formatCents } from "@/lib/money";
import { formatDate, formatMonth, formatRelative } from "@/lib/dates";
import { OPS } from "@/lib/routes";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * A subscription on its way: the terms held on an open setup link, priced as
 * the client sees them on the welcome page. Becomes a real SubscriptionCard
 * the moment the client pays.
 */
export function PendingSubscriptionCard({
  tenantId,
  pending,
  canMutate,
}: {
  tenantId: string;
  pending: PendingSetupTerms;
  canMutate: boolean;
}) {
  const p = pending.proposal;
  const lines = p.lines.filter((l) => !l.catchUp);
  const expired = pending.status === "expired";
  const recurring = [
    p.monthlyCents ? `${formatCents(p.monthlyCents)}/mo` : null,
    p.yearlyCents ? `${formatCents(p.yearlyCents)}/yr` : null,
  ].filter(Boolean);

  return (
    <Card className="gap-4 border-dashed py-5">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full opacity-60" style={{ background: pending.productColor ?? "var(--primary)" }} />
            <Link href={OPS.product(pending.productId)} className="font-medium text-heading hover:text-primary">
              {pending.productName}
            </Link>
            <StatusBadge kind="invite" status={pending.status} label={expired ? "setup link expired" : "awaiting client"} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Setup link for {pending.clientEmail} · created {formatDate(pending.createdAt)}
            {expired ? ` · expired ${formatDate(pending.expiresAt)}` : ` · expires ${formatDate(pending.expiresAt)} (${formatRelative(pending.expiresAt)})`}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {expired
              ? "The client can no longer open this link — regenerate it to keep these terms."
              : `The client pays ${formatCents(p.dueTodayCents)} on the link and adds a card; the subscription starts then${recurring.length ? `, ${recurring.join(" + ")}` : ""}${p.billFromMonth ? ` billed from ${formatMonth(p.billFromMonth)} with renewals on the 1st` : ""}.`}
          </p>
        </div>
        {canMutate && (
          <SetupLinkActions
            invite={{ id: pending.inviteId, clientEmail: pending.clientEmail, hasStoredToken: pending.hasStoredToken }}
            status={pending.status}
          />
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {lines.map((l) => (
            <li key={l.name} className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-1.5">
              <span className="truncate text-heading">
                {l.name}
                {l.quantity > 1 && <span className="ml-1 text-xs text-muted-foreground">×{l.quantity}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {l.quantity > 1 ? `${formatCents(l.unitAmountCents)} ea · ${formatCents(l.amountCents)}` : formatCents(l.amountCents)}
                <span className="text-xs"> {l.oneTime ? "one-time" : l.cadence}</span>
                {l.settled && <Badge variant="outline" className="ml-1.5 text-[10px]">paid</Badge>}
                {l.waived && <Badge variant="outline" className="ml-1.5 text-[10px]">waived</Badge>}
              </span>
            </li>
          ))}
        </ul>
        {p.billFromMonth && p.catchUpCents > 0 && (
          <div className="text-xs text-muted-foreground">
            Catch-up on the link: {formatCents(p.catchUpCents)} for {formatMonth(p.billFromMonth)} through this month.
          </div>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Link2 className="size-3.5" /> Manage every setup link from the{" "}
          <Link href={OPS.client(tenantId)} className="hover:text-primary">
            Overview tab
          </Link>.
        </div>
      </CardContent>
    </Card>
  );
}
