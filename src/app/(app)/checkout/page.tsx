import { redirect } from "next/navigation";
import { getTenantContext } from "@/policy";
import { getProductBySlug } from "@/modules/catalog/queries";
import { getTenantOverrides } from "@/modules/billing/service";
import { CheckoutFlow } from "@/modules/billing/components/checkout-flow";
import { EmptyState } from "@/components/empty-state";
import { MARKETING, TENANT } from "@/lib/routes";

export const metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const { product: slug } = await searchParams;
  if (!slug) redirect(MARKETING.products);
  // A user with no workspace yet must still get here: the first purchase creates one.
  const { active, caps } = await getTenantContext({ returnTo: TENANT.checkoutFor(slug) });

  const product = await getProductBySlug(slug);
  if (!product) redirect(MARKETING.products);

  if (active && caps?.readOnlyReason) redirect(TENANT.billing); // suspended: pay, don't buy
  if (active && caps && !caps.roleCan("write")) {
    return (
      <EmptyState
        className="mx-auto mt-16 max-w-md"
        title="Purchases are for owners and admins"
        description="Ask a workspace owner or admin to add this product to your workspace."
      />
    );
  }
  // Tenant-negotiated prices show at checkout (billing v2).
  if (active) {
    const overrides = await getTenantOverrides(active.id, product.components.map((c) => c.id));
    product.components = product.components.map((c) => ({
      ...c,
      amountCents: overrides.get(c.id)?.amountCents ?? c.amountCents,
    }));
  }

  return (
    <CheckoutFlow
      product={product}
      tenantId={active?.id ?? null}
      publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""}
      promosEnabled={process.env.PROMOS_ENABLED === "true"}
    />
  );
}
