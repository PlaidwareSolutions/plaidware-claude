"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
  toggleDunningPauseAction,
} from "../ar-actions";
import { formatCents } from "@/lib/money";
import { OPS } from "@/lib/routes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  RecordPaymentDialog,
  type HostingTarget,
  type InvoiceTarget,
  type TenantTarget,
} from "./ops-billing-dialogs";

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
  config: { stripe: boolean; webhook: boolean; email: boolean };
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
  schedule: { dunningNextUtc: string; hostingNextUtc: string };
};

const CLOSED = new Set(["canceled", "expired"]);
const STRIPE = "https://dashboard.stripe.com";

const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
const fmtUtc = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${String(d.getUTCHours()).padStart(2, "0")}:00 UTC`;
};
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function subStatusBadge(status: string) {
  const variant =
    status === "active" ? ("secondary" as const)
    : status === "trialing" || status === "incomplete" ? ("outline" as const)
    : ("destructive" as const);
  return <Badge variant={variant}>{status.replace("_", " ")}</Badge>;
}

function invoiceBadge(status: string) {
  const variant =
    status === "paid" ? ("secondary" as const)
    : status === "open" || status === "draft" || status === "void" ? ("outline" as const)
    : ("destructive" as const);
  return <Badge variant={variant}>{status}</Badge>;
}

/** How the next renewal will actually collect, from Stripe's point of view. */
function collectionBadge(a: SubscriptionAutomation | undefined) {
  if (!a || a.error) {
    return <Badge variant="outline" title={a?.error ?? undefined}>unknown</Badge>;
  }
  if (a.collectionMethod === "charge_automatically" && a.cardOnFile) {
    return <Badge variant="secondary">auto-charge</Badge>;
  }
  if (a.collectionMethod === "charge_automatically") {
    return <Badge variant="destructive">auto-charge · no card</Badge>;
  }
  return a.cardOnFile
    ? <Badge variant="outline">emailed invoice · card on file</Badge>
    : <Badge variant="destructive">emailed invoice · no card</Badge>;
}

export function OpsBillingBoard(p: BillingBoardProps) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<TenantTarget | null>(null);
  const [payFor, setPayFor] = useState<InvoiceTarget | null>(null);
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

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string } | { ok: true } | { ok: false; error: string }>, okMsg: string | ((r: unknown) => string)) {
    setPending(key);
    try {
      const res = await fn();
      if (res.ok) {
        toast.success(typeof okMsg === "function" ? okMsg(res) : okMsg);
        router.refresh();
      } else toast.error("error" in res ? res.error : "Something went wrong");
    } finally {
      setPending(null);
    }
  }

  async function sendCardLink(t: { id: string; name: string }) {
    setPending(`card:${t.id}`);
    try {
      const res = await sendCardSetupLinkAction(t.id);
      if (res.ok) {
        await navigator.clipboard.writeText(res.url).catch(() => {});
        toast.success(
          res.sentTo ? `Card setup link emailed to ${res.sentTo} — also copied` : "Card setup link copied (no billing contact to email)",
        );
      } else toast.error(res.error);
    } finally {
      setPending(null);
    }
  }

  function exportCsv() {
    const header = ["Client", "Owner email", "Product", "Subscription status", "Monthly (USD)", "Collection", "Card on file", "Next charge", "Collected (USD)"];
    const lines: string[] = [];
    for (const t of p.tenants) {
      const subs = p.subscriptions.filter((s) => s.tenantId === t.id);
      const collected = ((collectedByTenant.get(t.id) ?? 0) / 100).toFixed(2);
      if (subs.length === 0) {
        lines.push([t.name, t.ownerEmail ?? "", "", "none", "", "", "", "", collected].map(csvCell).join(","));
        continue;
      }
      for (const s of subs) {
        const a = autoById.get(s.id);
        lines.push(
          [
            t.name, t.ownerEmail ?? "", s.productName, s.status, (s.monthlyCents / 100).toFixed(2),
            a?.collectionMethod ?? "", a ? (a.cardOnFile ? "yes" : "no") : "",
            (a?.nextChargeAt ?? s.currentPeriodEnd)?.slice(0, 10) ?? "", collected,
          ].map(csvCell).join(","),
        );
      }
    }
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `billing-${p.generatedAt.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
            disabled={pending !== null}
            onClick={() => {
              if (!window.confirm("Run the reminder & dunning sweep now? Past-due clients get reminders; 14+ days overdue get suspended.")) return;
              void run("sweep", runDunningSweepAction, (r) => {
                const x = r as { reminded: number; suspended: number; opened: number };
                return `Sweep done — ${x.opened} opened, ${x.reminded} reminded, ${x.suspended} suspended`;
              });
            }}
          >
            <PlayCircle className="size-4" /> {pending === "sweep" ? "Running…" : "Run dunning sweep"}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            disabled={pending !== null}
            onClick={() => {
              if (!window.confirm("Generate last month's hosting-fee invoices now? Skips any already created.")) return;
              void run("hosting", () => generateHostingInvoicesAction(), (r) => {
                const x = r as { created: number; skipped: number };
                return `Hosting invoices — ${x.created} created, ${x.skipped} skipped`;
              });
            }}
          >
            <Receipt className="size-4" /> {pending === "hosting" ? "Generating…" : "Generate hosting invoices"}
          </Button>
          <Button variant="outline" className="gap-2" onClick={exportCsv}>
            <Download className="size-4" /> Export CSV
          </Button>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Clients", value: String(p.tenants.length), sub: `${tenantsWithProduct} with a live product` },
          { label: "MRR", value: formatCents(p.stats.mrrCents), sub: `${p.stats.liveSubscriptions} live · ${p.stats.trialing} trialing` },
          { label: "Collected to date", value: formatCents(collectedCents), sub: `${p.invoices.filter((i) => i.status === "paid").length} paid invoices` },
          { label: "Past-due AR", value: formatCents(p.stats.pastDueCents), sub: `${p.stats.failedInvoices} failed · ${p.stats.suspendedSubscriptions} suspended` },
          { label: "Won't auto-collect", value: `${formatCents(atRiskCents)}/mo`, sub: `${atRisk.length} subscription${atRisk.length === 1 ? "" : "s"} need a card` },
        ].map((t) => (
          <Card key={t.label}>
            <CardHeader>
              <CardDescription>{t.label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{t.value}</CardTitle>
              <p className="text-xs text-muted-foreground">{t.sub}</p>
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* Automation health */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Billing automation
        </h2>
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
      </section>

      {/* Clients & products */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Clients & products
        </h2>
        <div className="rounded-lg border bg-card">
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
                            <div>{s.productName}</div>
                            {s.addons.length > 0 && (
                              <div className="text-xs text-muted-foreground">{s.addons.join(", ")}</div>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">No product yet</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {s ? subStatusBadge(s.status) : <Badge variant="outline">not set up</Badge>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s && s.monthlyCents > 0 ? `${formatCents(s.monthlyCents)}/mo` : "—"}
                        {a && !a.error && a.yearlyCents > 0 && (
                          <div className="text-xs text-muted-foreground">+{formatCents(a.yearlyCents)}/yr</div>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {s && live ? collectionBadge(a) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {s && live ? fmtDay(a?.nextChargeAt ?? s.currentPeriodEnd) : "—"}
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
                              <Link href={OPS.client(t.id)}>Open tenant</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setInvoiceFor({ id: t.id, name: t.name })}>
                              <FilePlus2 className="size-4" /> New invoice
                            </DropdownMenuItem>
                            {s && live && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="font-normal text-muted-foreground">{s.productName}</DropdownMenuLabel>
                                <DropdownMenuItem onSelect={() => setHostingFor({ id: s.id, productName: s.productName })}>
                                  <Receipt className="size-4" /> Hosting fee…
                                </DropdownMenuItem>
                                {a && !a.error && a.collectionMethod === "send_invoice" && a.cardOnFile && (
                                  <DropdownMenuItem
                                    onSelect={() => void run(`auto:${s.id}`, () => switchToAutoChargeAction(s.id), "Renewals will now charge the card on file")}
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
                                    <a href={`${STRIPE}/subscriptions/${a.stripeSubscriptionId}`} target="_blank" rel="noreferrer">
                                      <ExternalLink className="size-4" /> Subscription in Stripe
                                    </a>
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => {
                                    if (!window.confirm(`Cancel ${t.name}'s ${s.productName} subscription now? This stops billing immediately.`)) return;
                                    void run(`cancel:${s.id}`, () => opsCancelSubscriptionAction(s.id), "Subscription canceled");
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
                                  <a href={`${STRIPE}/customers/${t.stripeCustomerId}`} target="_blank" rel="noreferrer">
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
        </div>
      </section>

      {/* Upcoming */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          What happens next
        </h2>
        <Card>
          <CardContent className="divide-y pt-2">
            {events.map((e, i) => (
              <div key={i} className="grid grid-cols-[7.5rem_1fr_auto] items-start gap-4 py-3">
                <div className="text-sm font-medium tabular-nums text-heading">
                  {e.amountCents != null ? fmtDay(e.at) : fmtUtc(e.at)}
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
      </section>

      {/* Payment history */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Payment history
        </h2>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Due</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden text-right md:table-cell">Paid</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.invoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    <Receipt className="mx-auto mb-2 size-8 opacity-40" />
                    No invoices yet.
                  </TableCell>
                </TableRow>
              )}
              {p.invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <div className="font-mono text-xs text-heading">{inv.invoiceNumber}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[10px]">{inv.kind}</Badge>
                      {inv.dunning && !inv.dunning.suspendedAt && (
                        <Badge variant="destructive" className="text-[10px]">dunning · {inv.dunning.remindersSent} reminders</Badge>
                      )}
                      {inv.dunning?.suspendedAt && <Badge variant="destructive" className="text-[10px]">suspended</Badge>}
                      {inv.dunning?.paused && <Badge variant="outline" className="text-[10px]">dunning paused</Badge>}
                    </div>
                    {inv.payments.length > 0 && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {inv.payments.map((pay) => (
                          <div key={pay.id}>
                            {formatCents(pay.amountCents)} · {pay.method.replace("_", " ")}
                            {pay.reference ? ` · ${pay.reference}` : ""} · {fmtDay(pay.receivedAt)}
                          </div>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={OPS.client(inv.tenantId)} className="hover:text-primary">{inv.tenantName}</Link>
                    <div className="text-xs text-muted-foreground">{fmtDay(inv.createdAt)}</div>
                  </TableCell>
                  <TableCell>{invoiceBadge(inv.status)}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{fmtDay(inv.dueDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(inv.amountDueCents)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {inv.amountPaidCents > 0 ? (
                      <span className={inv.status === "paid" ? "text-success" : ""}>{formatCents(inv.amountPaidCents)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {inv.hostedInvoiceUrl && (
                        <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="p-1 text-primary" title="Hosted invoice">
                          <ExternalLink className="size-4" />
                        </a>
                      )}
                      {!["paid", "void"].includes(inv.status) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          onClick={() =>
                            setPayFor({
                              id: inv.id,
                              invoiceNumber: inv.invoiceNumber,
                              amountDueCents: inv.amountDueCents,
                              amountPaidCents: inv.amountPaidCents,
                            })
                          }
                        >
                          <HandCoins className="size-4" /> Record
                        </Button>
                      )}
                      {inv.dunning && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending !== null}
                          onClick={() =>
                            void run(
                              `dun:${inv.id}`,
                              () => toggleDunningPauseAction(inv.dunning!.id, !inv.dunning!.paused),
                              inv.dunning!.paused ? "Dunning resumed" : "Dunning paused",
                            )
                          }
                        >
                          {inv.dunning.paused ? "Resume" : "Pause"}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <NewInvoiceDialog key={invoiceFor?.id ?? "none"} target={invoiceFor} onOpenChange={(o) => !o && setInvoiceFor(null)} />
      <RecordPaymentDialog key={payFor?.id ?? "none"} target={payFor} onOpenChange={(o) => !o && setPayFor(null)} />
      <HostingFeeDialog key={hostingFor?.id ?? "none"} target={hostingFor} onOpenChange={(o) => !o && setHostingFor(null)} />
    </div>
  );
}
