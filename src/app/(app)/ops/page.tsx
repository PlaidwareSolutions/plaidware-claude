import Link from "next/link";
import { requireOpsPage } from "@/policy";
import { listAllTenants, listPlatformUsers } from "@/modules/tenancy/queries";
import { countNewContactSubmissions } from "@/modules/contact/queries";
import { listActiveProducts } from "@/modules/catalog/queries";
import { getPlatformBillingStats, listAllSubscriptionsOps } from "@/modules/billing/queries";
import { getActiveIncidents, findQuietReporters, uptimeBySubscription } from "@/modules/monitoring/service";
import { listOpenSetupInvites } from "@/modules/onboarding/queries";
import { countDeadDeliveries } from "@/modules/webhooks_out/queries";
import { unreadCount } from "@/modules/messaging/service";
import { currentMonth, marginByProduct } from "@/modules/costs/service";
import { BILLING_SCHEDULE } from "@/modules/billing/schedule";
import { COSTS_SCHEDULE, MONITORING_SCHEDULE, SEO_SCHEDULE } from "@/modules/monitoring/schedule";
import { ONBOARDING_SCHEDULE } from "@/modules/onboarding/jobs";
import { nextDailyRunUtc } from "@/lib/schedule";
import { formatCents } from "@/lib/money";
import { formatUtcHour } from "@/lib/dates";
import { OPS, withQuery } from "@/lib/routes";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { StatTile } from "@/components/stat-tile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Command Center" };
export const dynamic = "force-dynamic";

const CLOSED = new Set(["canceled", "expired"]);

export default async function OpsHomePage() {
  await requireOpsPage();

  const [tenants, users, newLeads, products, billing, incidents, quiet, inboxUnread, deadLetters, subs, openInvites, margins] =
    await Promise.all([
      listAllTenants(),
      listPlatformUsers(),
      countNewContactSubmissions(),
      listActiveProducts(),
      getPlatformBillingStats(),
      getActiveIncidents(),
      findQuietReporters(),
      unreadCount("ops"),
      countDeadDeliveries(),
      listAllSubscriptionsOps(),
      listOpenSetupInvites(),
      marginByProduct(currentMonth()).catch(() => []),
    ]);
  const live = subs.filter((s) => !CLOSED.has(s.status));
  const uptime = await uptimeBySubscription(live.map((s) => s.id));
  const probed = [...uptime.values()].filter((u) => u.probes > 0);
  const fleetUptime = probed.length
    ? Math.round((probed.reduce((s, u) => s + (u.uptimePct ?? 0), 0) / probed.length) * 100) / 100
    : null;
  const revenueMtd = margins.reduce((s, m) => s + m.revenueCents, 0);
  const costKnown = margins.filter((m) => m.costCents != null);
  const costMtd = costKnown.length ? costKnown.reduce((s, m) => s + (m.costCents ?? 0), 0) : null;
  const marginMtd = costMtd != null && revenueMtd > 0 ? Math.round(((revenueMtd - costMtd) / revenueMtd) * 100) : null;
  const expiredLinks = openInvites.filter((i) => i.isExpired).length;

  const jobs = [
    BILLING_SCHEDULE.dunningSweep,
    BILLING_SCHEDULE.hostingInvoices,
    MONITORING_SCHEDULE.uptimeProbe,
    MONITORING_SCHEDULE.prune,
    MONITORING_SCHEDULE.quietReporters,
    SEO_SCHEDULE.sweep,
    COSTS_SCHEDULE.railwaySync,
    ONBOARDING_SCHEDULE.expireInvites,
  ];
  const nextSweep = nextDailyRunUtc(BILLING_SCHEDULE.dunningSweep.hourUtc);

  const areas = [
    {
      name: "Clients",
      value: `${tenants.length} client${tenants.length === 1 ? "" : "s"}`,
      detail: `${users.length} accounts · ${openInvites.length} open setup link${openInvites.length === 1 ? "" : "s"}${expiredLinks ? ` (${expiredLinks} expired)` : ""}`,
      href: OPS.clients,
    },
    {
      name: "Billing",
      value: formatCents(billing.pastDueCents),
      detail: `past due · ${billing.liveSubscriptions} live subscriptions · ${billing.failedInvoices} failed invoices`,
      href: OPS.billing,
    },
    {
      name: "Products",
      value: `${products.length} active`,
      detail: marginMtd != null ? `${marginMtd}% gross margin month-to-date` : "Catalog, pricing, KPIs, and provisioning defaults",
      href: OPS.products,
    },
    {
      name: "Monitoring",
      value: `${incidents.length} incident${incidents.length === 1 ? "" : "s"}`,
      detail: incidents[0]
        ? `${incidents[0].tenantName} · ${incidents[0].productName} is ${incidents[0].status}`
        : quiet.length
          ? `${quiet.length} reporter${quiet.length === 1 ? "" : "s"} gone quiet`
          : fleetUptime != null
            ? `Fleet uptime ${fleetUptime}% over 30 days`
            : "All monitored sites healthy",
      href: OPS.monitoring,
    },
    {
      name: "Inbox",
      value: `${inboxUnread} unread`,
      detail: `${newLeads} new lead${newLeads === 1 ? "" : "s"} from the marketing site`,
      href: OPS.inbox,
    },
    {
      name: "System",
      value: `${jobs.length} automations`,
      detail: `${deadLetters} dead letter${deadLetters === 1 ? "" : "s"} · next dunning sweep ${formatUtcHour(nextSweep)}`,
      href: OPS.system,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Command Center" description="What needs attention across every client." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="MRR" value={formatCents(billing.mrrCents)} href={OPS.billing} sub={`${billing.liveSubscriptions} live · ${billing.trialing} trialing`} />
        <StatTile
          label="Past-due AR"
          value={formatCents(billing.pastDueCents)}
          href={OPS.billing}
          tone={billing.pastDueCents > 0 ? "warning" : "default"}
          sub={`${billing.failedInvoices} failed · ${billing.suspendedSubscriptions} suspended`}
        />
        <StatTile
          label="Open incidents"
          value={incidents.length}
          href={OPS.monitoring}
          tone={incidents.length > 0 ? "danger" : "success"}
          sub={quiet.length ? `${quiet.length} quiet reporter${quiet.length === 1 ? "" : "s"}` : "no quiet reporters"}
        />
        <StatTile
          label="Fleet uptime 30d"
          value={fleetUptime != null ? `${fleetUptime}%` : "—"}
          href={OPS.monitoring}
          tone={fleetUptime == null ? "default" : fleetUptime >= 99.5 ? "success" : fleetUptime >= 98 ? "warning" : "danger"}
          sub={`${probed.length} site${probed.length === 1 ? "" : "s"} probed`}
        />
        <StatTile
          label="Margin MTD"
          value={marginMtd != null ? `${marginMtd}%` : "—"}
          href={OPS.costs}
          tone={marginMtd == null ? "default" : marginMtd >= 70 ? "success" : marginMtd >= 40 ? "warning" : "danger"}
          sub={costMtd != null ? `${formatCents(revenueMtd)} in · ${formatCents(costMtd)} hosting` : "no cost data yet"}
        />
        <StatTile
          label="Needs a human"
          value={newLeads + deadLetters + expiredLinks}
          href={newLeads ? OPS.leads : deadLetters ? OPS.webhooks : OPS.clients}
          tone={newLeads + deadLetters + expiredLinks > 0 ? "warning" : "default"}
          sub={`${newLeads} lead${newLeads === 1 ? "" : "s"} · ${deadLetters} dead letter${deadLetters === 1 ? "" : "s"} · ${expiredLinks} expired link${expiredLinks === 1 ? "" : "s"}`}
        />
      </div>

      <Section title="Where to work">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((a) => (
            <Link key={a.name} href={a.href} className="block h-full">
              <Card className="h-full gap-3 py-5 transition-colors hover:border-primary/50">
                <CardHeader className="gap-1">
                  <CardDescription className="text-xs font-medium uppercase tracking-wider text-primary">{a.name}</CardDescription>
                  <CardTitle className="text-xl tabular-nums">{a.value}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">{a.detail}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </Section>

      {(incidents.length > 0 || billing.failedInvoices > 0 || expiredLinks > 0) && (
        <Section title="Shortcuts">
          <div className="flex flex-wrap gap-2 text-sm">
            {incidents.length > 0 && (
              <Link href={withQuery(OPS.monitoring, { status: "problem" })} className="rounded-full border px-3 py-1 hover:border-primary/50">Sites with problems →</Link>
            )}
            {billing.failedInvoices > 0 && (
              <Link href={OPS.billing} className="rounded-full border px-3 py-1 hover:border-primary/50">Failed invoices →</Link>
            )}
            {expiredLinks > 0 && (
              <Link href={OPS.clients} className="rounded-full border px-3 py-1 hover:border-primary/50">Expired setup links →</Link>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}
