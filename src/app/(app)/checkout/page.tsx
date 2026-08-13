import { redirect } from "next/navigation";
import { getSession } from "@/policy";
import { getProductBySlug } from "@/modules/catalog/queries";
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

  return (
    <CheckoutFlow
      product={product}
      publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""}
    />
  );
}
