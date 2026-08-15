import { redirect } from "next/navigation";
import { getSession } from "@/policy";
import { getProductBySlug } from "@/modules/catalog/queries";
import { getTenantOverrides } from "@/modules/billing/service";
import { getUserTenants } from "@/modules/tenancy/queries";
import { CheckoutFlow } from "@/modules/billing/components/checkout-flow";

export const metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const session = await getSession();
  const { product: slug } = await searchParams;
  if (!slug) redirect("/products");
  if (!session) redirect(`/login?redirect=${encodeURIComponent(`/checkout?product=${slug}`)}`);

  const product = await getProductBySlug(slug);
  if (!product) redirect("/products");

  // Tenant-negotiated prices show at checkout (billing v2).
  const tenants = await getUserTenants(session.user.id);
  const active =
    tenants.find((t) => t.id === session.session.activeOrganizationId) ?? tenants[0];
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
      publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""}
    />
  );
}
