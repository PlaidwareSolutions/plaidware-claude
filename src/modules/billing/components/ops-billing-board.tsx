"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Download,
  ExternalLink,
  FilePlus2,
  HandCoins,
  Mail,
  MoreHorizontal,
  PlayCircle,
  Receipt,
  XCircle,
} from "lucide-react";
import type { OpsInvoiceDto, OpsSubscriptionDto, SubscriptionAutomation } from "../queries";
import {
  generateHostingInvoicesAction,
  opsCancelSubscriptionAction,
  runDunningSweepAction,
  sendCardSetupLinkAction,
  switchToAutoChargeAction,
} from "../ar-actions";
import { formatCents } from "@/lib/money";
import { formatDay, formatUtcHour } from "@/lib/dates";
import { downloadCsv, toCsv } from "@/lib/csv";
import { OPS, stripeCustomerUrl, stripeSubscriptionUrl } from "@/lib/routes";
import { collectionKey } from "@/lib/status-variants";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { Section } from "@/components/section";
import { StatTile } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  HostingFeeDialog,
  NewInvoiceDialog,
  type HostingTarget,
  type TenantTarget,
} from "./ops-billing-dialogs";
import { InvoicesTable } from "./invoices-table";
import { BillingPolicyEditor, policySummary, type BillingPolicyDto } from "./billing-policy-editor";

export type BillingTenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  memberCount: number;
  stripeCustomerId: string | null;
  ownerEmail: string | null;
};

export type BillingBoardProps = {
  generatedAt: string;
  config: { stripe: boolean; webhook: boolean; email: boolean; testMode: boolean };
  stats: {
    mrrCents: number;
    pastDueCents: number;
    failedInvoices: number;
    liveSubscriptions: number;
    suspendedSubscriptions: number;
    trialing: number;
  };
  tenants: BillingTenantRow[];
  subscriptions: OpsSubscriptionDto[];
  automation: SubscriptionAutomation[];
  invoices: OpsInvoiceDto[];
  policy: BillingPolicyDto;
  schedule: { dunningNextUtc: string; hostingNextUtc: string };
};

const CLOSED = new Set(["canceled", "expired"]);
export function OpsBillingBoard(p: BillingBoardProps) {
  const { run, pending, isPending } = useAction();
  const confirm = useConfirm();
  const [invoiceFor, setInvoiceFor] = useState<TenantTarget | null>(null);
  const [hostingFor, setHostingFor] = useState<HostingTarget | null>(null);

  const autoById = new Map(p.automation.map((a) => [a.subscriptionId, a]));
  const collectedByTenant = new Map<string, number>();
  for (const inv of p.invoices) {
    collectedByTenant.set(inv.tenantId, (collectedByTenant.get(inv.tenantId) ?? 0) + inv.amountPaidCents);
  }
  const collectedCents = p.invoices.reduce((s, i) => s + i.amountPaidCents, 0);

  const liveSubs = p.subscriptions.filter((s) => !CLOSED.has(s.status));
  const atRisk = liveSubs.filter((s) => {
    const a = autoById.get(s.id);
    return a && !a.error && !(a.collectionMethod === "charge_automatically" && a.cardOnFile);
  });
  const atRiskCents = atRisk.reduce((s, x) => s + x.monthlyCents, 0);
  const autoCharging = liveSubs.length - atRisk.length;
  const tenantsWithProduct = new Set(liveSubs.map((s) => s.tenantId)).size;

  // Upcoming: each live subscription's next renewal + the two scheduled jobs.
  const events = (() => {
    type Ev = { at: string; title: string; detail: string; amountCents?: number; tone: "ok" | "warn" | "muted"; href?: string };
    const out: Ev[] = [];
    for (const s of liveSubs) {
      const a = autoById.get(s.id);
      const at = a?.nextChargeAt ?? s.currentPeriodEnd;
      if (!at) continue;
      const autoOk = a && !a.error && a.collectionMethod === "charge_automatically" && a.cardOnFile;
      const amount = a && !a.error && a.monthlyCents ? a.monthlyCents : s.monthlyCents;
      out.push({
        at,
        title: `${s.tenantName} — ${s.productName}`,
        detail: !a || a.error
          ? "Renewal per local records; Stripe status unavailable"
          : autoOk
            ? "Charges the card on file"
            : a.cardOnFile
              ? "Emails an invoice even though a card is on file — switch to auto-charge"
              : "Emails a payment link — no card on file, won't collect on its own",
        amountCents: amount,
        tone: !a || a.error ? "muted" : autoOk ? "ok" : "warn",
        href: OPS.client(s.tenantId),
      });
    }
    out.push({
      at: p.schedule.dunningNextUtc,
      title: "Reminder & dunning sweep",
      detail: "Pre-due notices, then 3 / 7 / 14-day past-due reminders and suspension. Runs daily.",
      tone: "muted",
    });
    out.push({
      at: p.schedule.hostingNextUtc,
      title: "Monthly hosting-fee invoices",
      detail: "Standalone hosting invoices for subscriptions with a hosting fee set. Runs on the 1st.",
      tone: "muted",
    });
    return out.sort((x, y) => x.at.localeCompare(y.at));
  })();

  async function sendCardLink(t: { id: string; name: string }) {
    const res = await run(() => sendCardSetupLinkAction(t.id), {
      key: `card:${t.id}`,
      refresh: false,
      success: (r) =>
        r.sentTo
          ? `Card setup link emailed to ${r.sentTo} — also copied`
          : "Card setup link copied (no billing contact to email)",
    });
    if (res?.ok) await navigator.clipboard.writeText(res.url).catch(() => {});
  }

  function exportCsv() {
    const header = ["Client", "Owner email", "Product", "Subscription status", "Monthly (USD)", "Collection", "Card on file", "Next charge", "Collected (USD)"];
    const rows: (string | number | null)[][] = [];
    for (const t of p.tenants) {
      const subs = p.subscriptions.filter((s) => s.tenantId === t.id);
      const collected = ((collectedByTenant.get(t.id) ?? 0) / 100).toFixed(2);
      if (subs.length === 0) {
        rows.push([t.name, t.ownerEmail, "", "none", "", "", "", "", collected]);
        continue;
      }
      for (const s of subs) {
        const a = autoById.get(s.id);
        rows.push([
          t.name, t.ownerEmail, s.productName, s.status, (s.monthlyCents / 100).toFixed(2),
          a?.collectionMethod ?? "", a ? (a.cardOnFile ? "yes" : "no") : "",
          (a?.nextChargeAt ?? s.currentPeriodEnd)?.slice(0, 10) ?? "", collected,
        ]);
      }
    }
    downloadCsv(`billing-${p.generatedAt.slice(0, 10)}.csv`, toCsv(header, rows));
  }

  const verdicts = [
    {
      title: "Auto invoice creation",
      ok: p.config.stripe && p.config.webhook,
      text: p.config.stripe && p.config.webhook
        ? "Stripe raises each recurring invoice on the subscription's cycle and the Hub mirrors it via webhook."
        : !p.config.stripe
          ? "Stripe isn't configured — no invoices will be created."
          : "Webhook secret is missing — Stripe invoices won't sync back to the Hub.",
    },
    {
      title: "Emailing",
      ok: p.config.email,
      text: p.config.email
        ? "Stripe emails invoices and receipts; the Hub sends pre-due, past-due, and renewal notices on the daily sweep."
        : "No email provider key — Hub reminders are logged, not sent. Stripe's own invoice emails still go out.",
    },
    {
      title: "Auto-charging",
      ok: liveSubs.length > 0 && atRisk.length === 0,
      warn: atRisk.length > 0,
      text: liveSubs.length === 0
        ? "No live subscriptions."
        : atRisk.length === 0
          ? `All ${liveSubs.length} live subscriptions charge a card on file at renewal.`
          : `${autoCharging} of ${liveSubs.length} auto-charge. ${atRisk.length} will only email a payment link — ${formatCents(atRiskCents)}/mo won't collect on its own.`,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            className="gap-2"
            disabled={pending}
            onClick={async () => {
              const ok = await confirm({
                title: "Run the reminder & dunning sweep now?",
                description: "Past-due clients get reminders; anything 14+ days overdue is suspended. The same sweep runs daily on its own.",
                confirmLabel: "Run sweep",
              });
              if (!ok) return;
              void run(runDunningSweepAction, {
                key: "sweep",
                success: (r) => `Sweep done — ${r.preDue} pre-due notices, ${r.opened} opened, ${r.reminded} reminded, ${r.suspended} suspended`,
              });
            }}
          >
            <PlayCircle className="size-4" /> {isPending("sweep") ? "Running…" : "Run dunning sweep"}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            disabled={pending}
            onClick={async () => {
              const ok = await confirm({
                title: "Generate last month's hosting-fee invoices now?",
                description: "Creates a standalone invoice per subscription with a hosting fee set; any already created are skipped.",
                confirmLabel: "Generate",
              });
              if (!ok) return;
              void run(() => generateHostingInvoicesAction(), {
                key: "hosting",
                success: (r) => `Hosting invoices — ${r.created} created, ${r.skipped} skipped`,
              });
            }}
          >
            <Receipt className="size-4" /> {isPending("hosting") ? "Generating…" : "Generate hosting invoices"}
          </Button>
          <Button variant="outline" className="gap-2" onClick={exportCsv}>
            <Download className="size-4" /> Export CSV
          </Button>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Clients" value={p.tenants.length} sub={`${tenantsWithProduct} with a live product`} href={OPS.clients} />
        <StatTile label="MRR" value={formatCents(p.stats.mrrCents)} sub={`${p.stats.liveSubscriptions} live · ${p.stats.trialing} trialing`} href={OPS.subscriptions} />
        <StatTile label="Collected to date" value={formatCents(collectedCents)} sub={`${p.invoices.filter((i) => i.status === "paid").length} paid invoices`} />
        <StatTile
          label="Past-due AR"
          value={formatCents(p.stats.pastDueCents)}
          sub={`${p.stats.failedInvoices} failed · ${p.stats.suspendedSubscriptions} suspended`}
          tone={p.stats.pastDueCents > 0 ? "warning" : "default"}
        />
        <StatTile
          label="Won't auto-collect"
          value={`${formatCents(atRiskCents)}/mo`}
          sub={`${atRisk.length} subscription${atRisk.length === 1 ? "" : "s"} need a card`}
          tone={atRisk.length > 0 ? "danger" : "success"}
        />
      </div>

      {/* Automation health */}
      <Section
        title="Billing automation"
        description={policySummary(p.policy)}
        actions={<BillingPolicyEditor policy={p.policy} />}
      >
        <div className="grid gap-4 md:grid-cols-3">
          {verdicts.map((v) => (
            <Card key={v.title}>
              <CardContent className="flex gap-3 pt-6">
                {v.ok ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                ) : v.warn ? (
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
                ) : (
                  <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
                )}
                <div>
                  <div className="font-medium text-heading">{v.title}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{v.text}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      {/* Clients & products */}
      <Section title="Clients & products" count={p.tenants.length}>
        <DataTableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Monthly</TableHead>
                <TableHead className="hidden md:table-cell">Collection</TableHead>
                <TableHead className="hidden lg:table-cell">Next charge</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Collected</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.tenants.length === 0 && (
                <TableEmpty colSpan={8} icon={Receipt} title="No clients yet" description="Onboard a client to see their products and collection status here." />
              )}
              {p.tenants.map((t) => {
                const subs = p.subscriptions
                  .filter((s) => s.tenantId === t.id)
                  .sort((a, b) => Number(CLOSED.has(a.status)) - Number(CLOSED.has(b.status)));
                const rows = subs.length ? subs : [null];
                return rows.map((s, i) => {
                  const a = s ? autoById.get(s.id) : undefined;
                  const live = s ? !CLOSED.has(s.status) : false;
                  const tenantCell = (
                    <TableCell>
                      {i === 0 ? (
                        <>
                          <Link href={OPS.client(t.id)} className="font-medium text-heading hover:text-primary">
                            {t.name}
                          </Link>
                          <div className="text-xs text-muted-foreground">{t.ownerEmail ?? t.slug}</div>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">↳ {t.name}</span>
                      )}
                    </TableCell>
                  );
                  return (
                    <TableRow key={s ? s.id : t.id}>
                      {tenantCell}
                      <TableCell>
                        {s ? (
                          <>
                            <Link href={OPS.product(s.productId)} className="hover:text-primary">{s.productName}</Link>
                            {s.addons.length > 0 && (
                              <div className="text-xs text-muted-foreground">{s.addons.join(", ")}</div>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">No product yet</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {s ? (
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge kind="subscription" status={s.status} />
                            {a?.stripeStatus && a.stripeStatus.replace("_", " ") !== s.status.replace("_", " ") && (
                              <span className="text-[10px] text-muted-foreground">Stripe: {a.stripeStatus.replace("_", " ")}</span>
                            )}
                            {a?.cancelAtPeriodEnd && (
                              <Badge variant="warning" className="text-[10px]">cancels {formatDay(a.nextChargeAt)}</Badge>
                            )}
                          </div>
                        ) : (
                          <Badge variant="outline">not set up</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s && s.monthlyCents > 0 ? `${formatCents(s.monthlyCents)}/mo` : "—"}
                        {a && !a.error && a.yearlyCents > 0 && (
                          <div className="text-xs text-muted-foreground">+{formatCents(a.yearlyCents)}/yr</div>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {s && live ? (
                          <StatusBadge kind="collection" status={collectionKey(a)} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {s && live ? formatDay(a?.nextChargeAt ?? s.currentPeriodEnd) : "—"}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {i === 0 ? formatCents(collectedByTenant.get(t.id) ?? 0) : ""}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="size-8 p-0" aria-label={`Actions for ${t.name}`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>{t.name}</DropdownMenuLabel>
                            <DropdownMenuItem asChild>
                              <Link href={OPS.client(t.id)}>Open client</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setInvoiceFor({ id: t.id, name: t.name })}>
                              <FilePlus2 className="size-4" /> New invoice
                            </DropdownMenuItem>
                            {s && live && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="font-normal text-muted-foreground">{s.productName}</DropdownMenuLabel>
                                <DropdownMenuItem onSelect={() => setHostingFor({ id: s.id, productName: s.productName, monthlyHostingCents: s.monthlyHostingCents, hostingBillingStartMonth: s.hostingBillingStartMonth })}>
                                  <Receipt className="size-4" /> Hosting fee…
                                </DropdownMenuItem>
                                {a && !a.error && a.collectionMethod === "send_invoice" && a.cardOnFile && (
                                  <DropdownMenuItem
                                    onSelect={() => void run(() => switchToAutoChargeAction(s.id), { key: `auto:${s.id}`, success: "Renewals will now charge the card on file" })}
                                  >
                                    <CreditCard className="size-4" /> Switch to auto-charge
                                  </DropdownMenuItem>
                                )}
                                {a && !a.error && !a.cardOnFile && (
                                  <DropdownMenuItem onSelect={() => void sendCardLink({ id: t.id, name: t.name })}>
                                    <Mail className="size-4" /> Send card setup link
                                  </DropdownMenuItem>
                                )}
                                {a?.stripeSubscriptionId && (
                                  <DropdownMenuItem asChild>
                                    <a href={stripeSubscriptionUrl(a.stripeSubscriptionId, p.config.testMode)} target="_blank" rel="noreferrer">
                                      <ExternalLink className="size-4" /> Subscription in Stripe
                                    </a>
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={async () => {
                                    const ok = await confirm({
                                      title: `Cancel ${t.name}'s ${s.productName} subscription?`,
                                      description: "Billing stops immediately in Stripe and the Hub. One-time work already delivered is not refunded.",
                                      confirmLabel: "Cancel subscription",
                                      destructive: true,
                                    });
                                    if (!ok) return;
                                    void run(() => opsCancelSubscriptionAction(s.id), { key: `cancel:${s.id}`, success: "Subscription canceled" });
                                  }}
                                >
                                  <XCircle className="size-4" /> Cancel subscription…
                                </DropdownMenuItem>
                              </>
                            )}
                            {t.stripeCustomerId && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild>
                                  <a href={stripeCustomerUrl(t.stripeCustomerId, p.config.testMode)} target="_blank" rel="noreferrer">
                                    <ExternalLink className="size-4" /> Customer in Stripe
                                  </a>
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                });
              })}
            </TableBody>
          </Table>
        </DataTableShell>
      </Section>

      {/* Upcoming */}
      <Section title="What happens next" count={events.length}>
        <Card>
          <CardContent className="divide-y pt-2">
            {events.map((e, i) => (
              <div key={i} className="grid grid-cols-[7.5rem_1fr_auto] items-start gap-4 py-3">
                <div className="text-sm font-medium tabular-nums text-heading">
                  {e.amountCents != null ? formatDay(e.at) : formatUtcHour(e.at)}
                </div>
                <div>
                  <div className="text-sm font-medium text-heading">
                    {e.href ? <Link href={e.href} className="hover:text-primary">{e.title}</Link> : e.title}
                  </div>
                  <div className={`text-xs ${e.tone === "warn" ? "text-warning" : "text-muted-foreground"}`}>{e.detail}</div>
                </div>
                <div className="text-right text-sm tabular-nums">
                  {e.amountCents != null ? formatCents(e.amountCents) : ""}
                </div>
              </div>
            ))}
            {events.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing scheduled.</p>
            )}
          </CardContent>
        </Card>
      </Section>

      {/* Payment history */}
      <Section title="Payment history" count={p.invoices.length}>
        <InvoicesTable invoices={p.invoices} showClient />
      </Section>

      <NewInvoiceDialog key={invoiceFor?.id ?? "none"} target={invoiceFor} onOpenChange={(o) => !o && setInvoiceFor(null)} />
      <HostingFeeDialog key={hostingFor?.id ?? "none"} target={hostingFor} onOpenChange={(o) => !o && setHostingFor(null)} />
    </div>
  );
}
