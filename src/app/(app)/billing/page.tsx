import { requireTenantPage } from "@/policy";
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
  const { active, caps } = await requireTenantPage();
  if (!caps.roleCan("billing")) {
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
  return (
    <BillingView
      tenantId={active.id}
      canWrite={caps.can("write")}
      readOnlyReason={caps.readOnlyReason}
      subscriptions={subscriptions}
      invoices={invoices}
      addonOptions={addonOptions}
    />
  );
}
