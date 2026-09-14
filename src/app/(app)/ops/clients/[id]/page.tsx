import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, CreditCard, ExternalLink, MessageSquare, Receipt } from "lucide-react";
import { requireOpsPage } from "@/policy";
import { getTenant, listMembers } from "@/modules/tenancy/queries";
import {
  listAllInvoicesOps,
  listTenantPricingRows,
  listTenantSubscriptions,
} from "@/modules/billing/queries";
import { listTenantProvisioning } from "@/modules/provisioning/queries";
import { tenantTimeline } from "@/modules/audit/service";
import { OpsTenantBilling } from "@/modules/billing/components/ops-tenant-billing";
import { OpsCustomPricing } from "@/modules/billing/components/ops-custom-pricing";
import { OpsProvisioning } from "@/modules/provisioning/components/ops-provisioning";
import { LIVE_SUBSCRIPTION_STATUSES } from "@/modules/billing/mappers";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { OPS, stripeCustomerUrl, withQuery } from "@/lib/routes";
import { stripeTestMode } from "@/lib/stripe";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const loadTenant = cache(getTenant);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await loadTenant(id);
  return { title: tenant?.name ?? "Client" };
}

export default async function OpsClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOpsPage();

  const { id } = await params;
  const tenant = await loadTenant(id);
  if (!tenant) notFound();

  const [members, subscriptions, invoices, pricingRows, timeline] = await Promise.all([
    listMembers(id),
    listTenantSubscriptions(id),
    listAllInvoicesOps(100, { tenantId: id }),
    listTenantPricingRows(id),
    tenantTimeline(id),
  ]);
  const provisioning = await listTenantProvisioning(subscriptions);

  const live = subscriptions.filter((s) =>
    (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(s.status),
  );
  const mrrCents = subscriptions.reduce((sum, s) => sum + s.monthlyCents, 0);
  const outstandingCents = invoices
    .filter((i) => i.status === "open" || i.status === "failed")
    .reduce((sum, i) => sum + i.amountDueCents - i.amountPaidCents, 0);
  const lifetimeCents = invoices.reduce((sum, i) => sum + i.amountPaidCents, 0);
  const pastDueCount = invoices.filter((i) => i.pastDue).length;
  const dnsProblems = provisioning.filter((p) =>
    ["unconfigured", "failing", "no_domain"].includes(p.state),
  ).length;
  const slug = tenant.slug ?? "";
  const status = tenant.status ?? "active";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        back={{ href: OPS.clients, label: "Clients" }}
        title={tenant.name}
        badge={<StatusBadge kind="tenant" status={status} />}
        meta={
          <>
            {slug} · {members.length} member{members.length === 1 ? "" : "s"} · since{" "}
            {formatDate(tenant.createdAt)}
          </>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={withQuery(OPS.subscriptions, { q: slug })}>
                <Receipt className="size-4" /> Subscriptions
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={withQuery(OPS.monitoring, { tenant: id })}>
                <Activity className="size-4" /> Monitoring
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={withQuery(OPS.inbox, { tenant: id })}>
                <MessageSquare className="size-4" /> Inbox
              </Link>
            </Button>
            {tenant.stripeCustomerId && (
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a
                  href={stripeCustomerUrl(tenant.stripeCustomerId, stripeTestMode())}
                  target="_blank"
                  rel="noreferrer"
                >
                  <CreditCard className="size-4" /> Stripe <ExternalLink className="size-3" />
                </a>
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Monthly recurring" value={formatCents(mrrCents)} sub={`${live.length} live subscription${live.length === 1 ? "" : "s"}`} />
        <StatTile
          label="Outstanding"
          value={formatCents(outstandingCents)}
          tone={outstandingCents > 0 ? "warning" : "default"}
          sub="open + failed invoices"
        />
        <StatTile label="Lifetime paid" value={formatCents(lifetimeCents)} sub={`${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`} />
        <StatTile
          label="Provisioning"
          value={dnsProblems ? `${dnsProblems} need${dnsProblems === 1 ? "s" : ""} attention` : provisioning.length ? "All set" : "—"}
          tone={dnsProblems ? "warning" : provisioning.length ? "success" : "default"}
          sub={`${provisioning.length} product${provisioning.length === 1 ? "" : "s"} provisioned`}
        />
      </div>

      <OpsTenantBilling
        tenant={{ id: tenant.id, name: tenant.name }}
        subscriptions={subscriptions}
        invoices={invoices}
        pastDueCount={pastDueCount}
      />
      <OpsCustomPricing
        tenantId={id}
        rows={pricingRows}
        subscribedProductIds={live.map((s) => s.productId)}
      />
      <OpsProvisioning
        tenantId={id}
        items={provisioning}
        timeline={timeline.map((t) => ({
          id: t.id,
          kind: t.kind,
          actorName: t.actorName,
          createdAt: t.createdAt,
          payload: t.payload,
        }))}
      />
    </div>
  );
}
