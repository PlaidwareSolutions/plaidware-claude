import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, isOps } from "@/policy";
import { listAllTenants, listPlatformUsers } from "@/modules/tenancy/queries";
import { countNewContactSubmissions } from "@/modules/contact/queries";
import { listActiveProducts } from "@/modules/catalog/queries";
import { getPlatformBillingStats } from "@/modules/billing/queries";
import { getActiveIncidents, findQuietReporters } from "@/modules/monitoring/service";
import { unreadCount } from "@/modules/messaging/service";
import { formatCents } from "@/lib/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Command Center" };

export default async function OpsHomePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOps(session)) redirect("/dashboard");

  const [tenants, users, newLeads, products, billing, incidents, quiet, inboxUnread] =
    await Promise.all([
      listAllTenants(),
      listPlatformUsers(),
      countNewContactSubmissions(),
      listActiveProducts(),
      getPlatformBillingStats(),
      getActiveIncidents(),
      findQuietReporters(),
      unreadCount("ops"),
    ]);

  const pillars = [
    { n: 1, name: "Onboarding", value: `${newLeads} new leads`, detail: "Contact requests awaiting reply", href: "/ops/contact-inbox" },
    { n: 2, name: "Provisioning", value: `${quiet.length} gaps`, detail: "Quiet or unconfigured reporters", href: "/ops/incidents" },
    { n: 3, name: "Access & roles", value: `${users.length} accounts`, detail: `${tenants.length} tenant workspaces`, href: "/ops/users" },
    { n: 4, name: "Monitoring", value: `${incidents.length} incidents`, detail: incidents[0] ? `${incidents[0].productName} is ${incidents[0].status}` : "All systems healthy", href: "/ops/incidents" },
    { n: 5, name: "Billing", value: formatCents(billing.pastDueCents), detail: `${billing.failedInvoices} failed invoices · ${billing.suspendedSubscriptions} suspended`, href: "/ops/tenants" },
    { n: 6, name: "Automations", value: "8 jobs", detail: "Probes, dunning, sweeps, digests — on schedule", href: "/ops/incidents" },
  ];

  const tiles = [
    { label: "MRR", value: formatCents(billing.mrrCents), href: "/ops/tenants" },
    { label: "Past-due AR", value: formatCents(billing.pastDueCents), href: "/ops/tenants" },
    { label: "Live subscriptions", value: billing.liveSubscriptions, href: "/ops/tenants" },
    { label: "Trials", value: billing.trialing, href: "/ops/tenants" },
    { label: "Suspended", value: billing.suspendedSubscriptions, href: "/ops/tenants" },
    { label: "Failed invoices", value: billing.failedInvoices, href: "/ops/tenants" },
    { label: "Tenants", value: tenants.length, href: "/ops/tenants" },
    { label: "Products", value: products.length, href: "/ops/products" },
    { label: "Platform users", value: users.length, href: "/ops/users" },
    { label: "New contact requests", value: newLeads, href: "/ops/contact-inbox" },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-heading">Plaidware Command Center</h1>
        <p className="text-sm text-muted-foreground">
          Incidents, margin, and AR tiles arrive with their milestones (M5–M10).
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href}>
            <Card className="transition-colors hover:border-primary/50">
              <CardHeader>
                <CardDescription>{t.label}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{t.value}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Operating spine
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map((p) => (
            <Link key={p.n} href={p.href}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader className="pb-2">
                  <CardDescription className="font-mono text-xs text-primary">
                    {String(p.n).padStart(2, "0")} · {p.name}
                  </CardDescription>
                  <CardTitle className="text-xl tabular-nums">{p.value}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">{p.detail}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {inboxUnread > 0 && (
        <Link href="/ops/inbox" className="text-sm text-coral hover:underline">
          {inboxUnread} unread customer message{inboxUnread === 1 ? "" : "s"} →
        </Link>
      )}
    </div>
  );
}
