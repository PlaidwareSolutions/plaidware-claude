import Link from "next/link";
import { requireTenantPage } from "@/policy";
import {
  listAddonOptions,
  listTenantInvoices,
  listTenantSubscriptions,
} from "@/modules/billing/queries";
import { getOpenRoleRequestForUser } from "@/modules/tenancy/queries";
import { canRequestRoleChange } from "@/modules/tenancy/role-request-rules";
import { BillingView } from "@/modules/billing/components/billing-view";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { TENANT, withQuery } from "@/lib/routes";

export const metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const { session, ops, active, caps } = await requireTenantPage();
  if (!caps.roleCan("billing")) {
    const myRequest = ops ? null : await getOpenRoleRequestForUser(active.id, session.user.id);
    const canAsk = !ops && canRequestRoleChange({ role: caps.role, tenantStatus: active.status }).ok;
    return (
      <EmptyState
        className="mx-auto mt-16 max-w-md"
        title="Billing is for owners, admins, and billing members"
        description={
          myRequest
            ? "Your role request is waiting on a workspace owner or admin."
            : "Ask a workspace owner to change your role if you need to see invoices."
        }
        action={
          myRequest ? (
            <Button asChild variant="outline" size="sm">
              <Link href={TENANT.team}>View request</Link>
            </Button>
          ) : canAsk ? (
            <Button asChild size="sm">
              <Link href={withQuery(TENANT.team, { request: "billing" })}>Request billing access</Link>
            </Button>
          ) : undefined
        }
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
