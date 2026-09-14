import { redirect } from "next/navigation";
import { getSession, isOps, roleHasCapability, tenantStatusAllows, tenantStatusMessage } from "@/policy";
import { AUTH, TENANT } from "@/lib/routes";
import { getUserTenants } from "@/modules/tenancy/queries";
import {
  listAddonOptions,
  listTenantInvoices,
  listTenantSubscriptions,
} from "@/modules/billing/queries";
import { BillingView } from "@/modules/billing/components/billing-view";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await getSession();
  if (!session) redirect(AUTH.login);

  const tenants = await getUserTenants(session.user.id);
  const active =
    tenants.find((t) => t.id === session.session.activeOrganizationId) ?? tenants[0];
  if (!active) redirect(TENANT.dashboard);
  const ops = isOps(session);
  if (!roleHasCapability(active.role, "billing") && !ops) {
    return (
      <EmptyState
        className="mx-auto mt-16 max-w-md"
        title="Billing is for owners, admins, and billing members"
        description="Ask a workspace owner to change your role if you need to see invoices."
      />
    );
  }

  const [subscriptions, invoices] = await Promise.all([
    listTenantSubscriptions(active.id),
    listTenantInvoices(active.id),
  ]);
  // Add-on options per live subscription, with tenant pricing applied (v2).
  const addonOptions = await listAddonOptions(active.id, subscriptions);

  // A suspended workspace can still pay (billing) but not change anything (write).
  const statusAllowsWrite = ops || tenantStatusAllows(active.status, "write");
  return (
    <BillingView
      tenantId={active.id}
      canWrite={(ops || roleHasCapability(active.role, "write")) && statusAllowsWrite}
      readOnlyReason={statusAllowsWrite ? null : tenantStatusMessage(active.status)}
      subscriptions={subscriptions}
      invoices={invoices}
      addonOptions={addonOptions}
    />
  );
}
