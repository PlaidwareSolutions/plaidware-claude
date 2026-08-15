import { redirect } from "next/navigation";
import { getSession, roleHasCapability } from "@/policy";
import { getUserTenants } from "@/modules/tenancy/queries";
import {
  listTenantInvoices,
  listTenantSubscriptions,
} from "@/modules/billing/queries";
import { getTenantOverrides } from "@/modules/billing/service";
import { listActiveProducts } from "@/modules/catalog/queries";
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

  // Add-on options per live subscription, with tenant pricing applied (v2).
  const products = await listActiveProducts();
  const allComponentIds = products.flatMap((p) => p.components.map((c) => c.id));
  const overrides = await getTenantOverrides(active.id, allComponentIds);
  const addonOptions = Object.fromEntries(
    subscriptions
      .filter((s) => !["canceled", "expired"].includes(s.status))
      .map((s) => {
        const product = products.find((p) => p.id === s.productId);
        const activeItems = new Set(
          s.items.filter((i) => ["active", "pending"].includes(i.status)).map((i) => i.name),
        );
        return [
          s.id,
          (product?.components ?? [])
            .filter((c) => c.role !== "base" && !activeItems.has(c.name))
            .map((c) => ({
              id: c.id,
              name: c.name,
              kind: c.kind,
              interval: c.interval,
              intervalCount: c.intervalCount,
              amountCents: overrides.get(c.id)?.amountCents ?? c.amountCents,
            })),
        ];
      }),
  );

  return (
    <BillingView
      tenantId={active.id}
      canWrite={roleHasCapability(active.role, "write")}
      subscriptions={subscriptions}
      invoices={invoices}
      addonOptions={addonOptions}
    />
  );
}
