import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, isOps } from "@/policy";
import { listAllTenants, listPlatformUsers } from "@/modules/tenancy/queries";
import { countNewContactSubmissions } from "@/modules/contact/queries";
import { listActiveProducts } from "@/modules/catalog/queries";
import { getPlatformBillingStats } from "@/modules/billing/queries";
import { formatCents } from "@/lib/money";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Command Center" };

export default async function OpsHomePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOps(session)) redirect("/dashboard");

  const [tenants, users, newLeads, products, billing] = await Promise.all([
    listAllTenants(),
    listPlatformUsers(),
    countNewContactSubmissions(),
    listActiveProducts(),
    getPlatformBillingStats(),
  ]);

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
          <Link key={t.href} href={t.href}>
            <Card className="transition-colors hover:border-primary/50">
              <CardHeader>
                <CardDescription>{t.label}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{t.value}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
