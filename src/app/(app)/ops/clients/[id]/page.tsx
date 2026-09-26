import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, Package, SquareKanban } from "lucide-react";
import { requireOpsPage } from "@/policy";
import { listMembers, listPendingRoleRequests } from "@/modules/tenancy/queries";
import {
  getBillingAutomationStatus,
  listAllInvoicesOps,
  listTenantSubscriptions,
} from "@/modules/billing/queries";
import { summarizeClientBilling } from "@/modules/billing/client-summary";
import { listTenantProvisioning } from "@/modules/provisioning/queries";
import { findQuietReporters, getActiveIncidents } from "@/modules/monitoring/service";
import { listTenantSetupInvites } from "@/modules/onboarding/queries";
import { tenantDeliveryHealth } from "@/modules/webhooks_out/queries";
import { listItemsForTenant } from "@/modules/work/queries";
import { TypeIcon } from "@/modules/work/components/item-bits";
import { SOURCE_LABELS } from "@/modules/work/components/labels";
import { currentMonth, tenantCostBreakdown } from "@/modules/costs/service";
import { buildAttentionItems } from "@/modules/tenancy/client-attention";
import { SetupLinksCard } from "@/modules/onboarding/components/setup-links-card";
import { formatCents } from "@/lib/money";
import { formatDay, formatRelative } from "@/lib/dates";
import { OPS, WORK } from "@/lib/routes";
import { Section } from "@/components/section";
import { StatTile } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { loadClient, clientMetadata } from "./load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return clientMetadata(params);
}

const TONE = {
  danger: "border-destructive/40 text-destructive",
  warning: "border-warning/40 text-warning",
  info: "border-border text-heading",
} as const;

export default async function ClientOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOpsPage("support");
  const { id } = await params;
  const client = await loadClient(id);
  if (!client) notFound();

  const [subscriptions, invoices, automation, members, setupInvites, incidents, quiet, roleRequests, requests] =
    await Promise.all([
      listTenantSubscriptions(id),
      listAllInvoicesOps(200, { tenantId: id }),
      getBillingAutomationStatus({ tenantId: id }),
      listMembers(id),
      listTenantSetupInvites(id),
      getActiveIncidents({ tenantId: id }),
      findQuietReporters(new Date(), { tenantId: id }),
      listPendingRoleRequests(id),
      listItemsForTenant(id),
    ]);
  const [provisioning, deliveries, hosting] = await Promise.all([
    listTenantProvisioning(subscriptions),
    tenantDeliveryHealth(subscriptions.map((s) => s.id), id, 50),
    tenantCostBreakdown(id, currentMonth()).catch(() => null),
  ]);

  const summary = summarizeClientBilling({ subscriptions, invoices, automation });
  const attention = buildAttentionItems({
    tenantId: id,
    status: client.status,
    subscriptions,
    wontAutoCollect: summary.wontAutoCollect,
    pastDueCount: summary.pastDueCount,
    provisioning,
    incidents,
    quiet,
    setupInvites,
    deliveries: { dead: deliveries.dead, pending: deliveries.pending },
    members,
    roleRequests,
  });

  const siteProblems = provisioning.filter((p) => ["unconfigured", "failing"].includes(p.state)).length;
  const openRequests = requests.filter((r) => r.status !== "done" && r.status !== "canceled");
  const doneRequests = requests.length - openRequests.length;
  const live = subscriptions.filter((s) => !["canceled", "expired"].includes(s.status));

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Monthly recurring" value={formatCents(summary.mrrCents)} sub={`${summary.liveCount} live`} href={OPS.clientTab(id, "billing")} />
        <StatTile
          label="Outstanding"
          value={formatCents(summary.outstandingCents)}
          sub={summary.pastDueCount ? `${summary.pastDueCount} past due` : "nothing past due"}
          tone={summary.pastDueCount ? "warning" : "default"}
          href={OPS.clientTab(id, "billing")}
        />
        <StatTile label="Lifetime paid" value={formatCents(summary.lifetimePaidCents)} sub={`${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`} href={OPS.clientTab(id, "billing")} />
        <StatTile
          label="Next charge"
          value={summary.nextCharge ? formatDay(summary.nextCharge.at) : "—"}
          sub={
            summary.nextCharge
              ? `${formatCents(summary.nextCharge.amountCents)} · ${summary.nextCharge.productName}${summary.nextCharge.autoCollects ? "" : " · won't auto-collect"}`
              : "no live subscriptions"
          }
          tone={summary.nextCharge && !summary.nextCharge.autoCollects ? "warning" : "default"}
          href={OPS.clientTab(id, "billing")}
        />
        <StatTile
          label="Site health"
          value={incidents.length ? `${incidents.length} down` : siteProblems ? `${siteProblems} DNS issue${siteProblems === 1 ? "" : "s"}` : provisioning.length ? "Healthy" : "—"}
          sub={quiet.length ? `${quiet.length} reporter${quiet.length === 1 ? "" : "s"} quiet` : `${provisioning.length} provisioned`}
          tone={incidents.length ? "danger" : siteProblems || quiet.length ? "warning" : provisioning.length ? "success" : "default"}
          href={OPS.clientTab(id, incidents.length || quiet.length ? "monitoring" : "provisioning")}
        />
        <StatTile
          label="Hosting cost MTD"
          value={hosting ? formatCents(hosting.costCents) : "—"}
          sub={
            hosting
              ? `${hosting.apps.length} app${hosting.apps.length === 1 ? "" : "s"} · ${summary.mrrCents > 0 ? `${Math.round(((summary.mrrCents - hosting.costCents) / summary.mrrCents) * 100)}% of MRR kept` : "no MRR"}`
              : "no attributed apps"
          }
          href={OPS.costs}
        />
      </div>

      <Section title="Needs attention" icon={AlertTriangle} count={attention.length}>
        {attention.length === 0 ? (
          <EmptyState tone="success" icon={CheckCircle2} title="Nothing needs a human right now" description="Billing collects on its own, DNS is verified, and every reporter is checking in." />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {attention.map((a) => (
              <Link
                key={a.key}
                href={a.href}
                className={`flex flex-col gap-0.5 rounded-lg border bg-card px-4 py-3 text-sm transition-colors hover:border-primary/50 ${TONE[a.tone]}`}
              >
                <span className="font-medium">{a.title}</span>
                {a.detail && <span className="text-xs text-muted-foreground">{a.detail}</span>}
              </Link>
            ))}
          </div>
        )}
      </Section>

      <SetupLinksCard invites={setupInvites} compact />

      <Section title="Products" icon={Package} count={live.length} actions={<Link href={OPS.clientTab(id, "billing")} className="text-sm text-primary hover:underline">Manage →</Link>}>
        {subscriptions.length === 0 ? (
          <EmptyState icon={Package} title="No products yet" description="Products appear once ops starts a subscription or the client completes a setup link or checkout." />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {subscriptions.map((s) => {
              const prov = provisioning.find((p) => p.subscriptionId === s.id);
              return (
                <Link key={s.id} href={OPS.clientTab(id, "billing")} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/50">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.productColor ?? "var(--primary)" }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-heading">{s.productName}</span>
                      <StatusBadge kind="subscription" status={s.status} />
                      {prov && <StatusBadge kind="dns" status={prov.state} className="text-[10px]" />}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {s.monthlyCents > 0 ? `${formatCents(s.monthlyCents)}/mo` : "no recurring charge"}
                      {s.domainUrl ? ` · ${s.domainUrl}` : ""}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="Development requests"
        icon={SquareKanban}
        count={requests.length}
        description="work items this client asked for"
        actions={<Link href={WORK.home} className="text-sm text-primary hover:underline">Work →</Link>}
      >
        {requests.length === 0 ? (
          <EmptyState
            compact
            title="No requests linked to this client"
            description="Link a work item from its Requesting client field; developers see the client only if they're on its workspace."
          />
        ) : (
          <div className="flex flex-col gap-2">
            <ol className="divide-y rounded-lg border bg-card">
              {openRequests.slice(0, 8).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <TypeIcon type={r.type} />
                  <Link href={WORK.item(r.product.slug, r.number)} className="font-mono text-xs text-muted-foreground hover:text-primary">{r.key}</Link>
                  <Link href={WORK.item(r.product.slug, r.number)} className="min-w-0 flex-1 truncate font-medium text-heading hover:text-primary">{r.title}</Link>
                  <span className="text-xs text-muted-foreground">{r.product.name}</span>
                  <StatusBadge kind="workItem" status={r.status} className="text-[10px]" />
                  <StatusBadge kind="workPriority" status={r.priority} className="text-[10px]" />
                  <span className="text-xs text-muted-foreground">{SOURCE_LABELS[r.source]} · {formatRelative(r.updatedAt)}</span>
                </li>
              ))}
            </ol>
            {(openRequests.length > 8 || doneRequests > 0) && (
              <p className="text-xs text-muted-foreground">
                {openRequests.length > 8 ? `${openRequests.length - 8} more open · ` : ""}
                {doneRequests} done
              </p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
