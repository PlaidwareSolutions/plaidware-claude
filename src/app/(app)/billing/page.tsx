import { redirect } from "next/navigation";
import { getSession, roleHasCapability } from "@/policy";
import { getUserTenants } from "@/modules/tenancy/queries";
import {
  listTenantInvoices,
  listTenantSubscriptions,
} from "@/modules/billing/queries";
import { BillingView } from "@/modules/billing/components/billing-view";

export const metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const tenants = await getUserTenants(session.user.id);
  const active =
    tenants.find((t) => t.id === session.session.activeOrganizationId) ?? tenants[0];
  if (!active) redirect("/dashboard");
  if (!roleHasCapability(active.role, "billing") && session.user.platformRole !== "ops_admin") {
    return (
      <p className="mx-auto max-w-md pt-16 text-center text-sm text-muted-foreground">
        Billing is visible to workspace owners, admins, and billing members.
      </p>
    );
  }

  const [subscriptions, invoices] = await Promise.all([
    listTenantSubscriptions(active.id),
    listTenantInvoices(active.id),
  ]);

  return (
    <BillingView
      tenantId={active.id}
      canWrite={roleHasCapability(active.role, "write")}
      subscriptions={subscriptions}
      invoices={invoices}
    />
  );
}
