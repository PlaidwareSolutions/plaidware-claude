import Link from "next/link";
import { requireOpsPage } from "@/policy";
import { listAllTenants, listPlatformUsers } from "@/modules/tenancy/queries";
import { countNewContactSubmissions } from "@/modules/contact/queries";
import { listActiveProducts } from "@/modules/catalog/queries";
import { getPlatformBillingStats } from "@/modules/billing/queries";
import { getActiveIncidents, findQuietReporters } from "@/modules/monitoring/service";
import { countDeadDeliveries } from "@/modules/webhooks_out/queries";
import { unreadCount } from "@/modules/messaging/service";
import { BILLING_SCHEDULE, nextDailyRunUtc } from "@/modules/billing/schedule";
import { formatCents } from "@/lib/money";
import { formatUtcHour } from "@/lib/dates";
import { OPS } from "@/lib/routes";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { StatTile } from "@/components/stat-tile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Command Center" };
export const dynamic = "force-dynamic";

export default async function OpsHomePage() {
  await requireOpsPage();

  const [tenants, users, newLeads, products, billing, incidents, quiet, inboxUnread, deadLetters] =
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
    ]);
  const nextSweep = nextDailyRunUtc(BILLING_SCHEDULE.dunningSweep.hourUtc);

  const areas = [
    {
      name: "Clients",
      value: `${tenants.length} client${tenants.length === 1 ? "" : "s"}`,
      detail: `${users.length} accounts across all workspaces`,
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
      detail: "Catalog, pricing components, and what each product bills",
      href: OPS.products,
    },
    {
      name: "Monitoring",
      value: `${incidents.length} incident${incidents.length === 1 ? "" : "s"}`,
      detail: incidents[0]
        ? `${incidents[0].productName} is ${incidents[0].status}`
        : quiet.length
          ? `${quiet.length} reporter${quiet.length === 1 ? "" : "s"} gone quiet`
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
      value: `${deadLetters} dead letter${deadLetters === 1 ? "" : "s"}`,
      detail: `Next dunning sweep ${formatUtcHour(nextSweep)}`,
      href: OPS.system,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Command Center" description="What needs attention across every client." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="MRR" value={formatCents(billing.mrrCents)} href={OPS.billing} />
        <StatTile
          label="Past-due AR"
          value={formatCents(billing.pastDueCents)}
          href={OPS.billing}
          tone={billing.pastDueCents > 0 ? "warning" : "default"}
        />
        <StatTile
          label="Failed invoices"
          value={billing.failedInvoices}
          href={OPS.billing}
          tone={billing.failedInvoices > 0 ? "danger" : "default"}
        />
        <StatTile
          label="Open incidents"
          value={incidents.length}
          href={OPS.monitoring}
          tone={incidents.length > 0 ? "danger" : "success"}
        />
        <StatTile
          label="Quiet reporters"
          value={quiet.length}
          href={OPS.monitoring}
          tone={quiet.length > 0 ? "warning" : "default"}
        />
        <StatTile label="Live subscriptions" value={billing.liveSubscriptions} sub={`${billing.trialing} trialing · ${billing.suspendedSubscriptions} suspended`} href={OPS.subscriptions} />
        <StatTile label="Clients" value={tenants.length} href={OPS.clients} />
        <StatTile label="New leads" value={newLeads} href={OPS.leads} tone={newLeads > 0 ? "warning" : "default"} />
        <StatTile label="Unread messages" value={inboxUnread} href={OPS.inbox} tone={inboxUnread > 0 ? "warning" : "default"} />
        <StatTile
          label="Dead-letter webhooks"
          value={deadLetters}
          href={OPS.webhooks}
          tone={deadLetters > 0 ? "danger" : "default"}
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
    </div>
  );
}
