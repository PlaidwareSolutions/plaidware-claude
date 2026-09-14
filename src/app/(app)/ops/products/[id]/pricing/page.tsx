import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { ProductPricingPanel } from "@/modules/catalog/components/product-pricing-panel";
import { loadProduct, productMetadata } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return productMetadata(params, "Pricing");
}

export default async function ProductPricingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOpsPage();
  const { id } = await params;
  const data = await loadProduct(id);
  if (!data) notFound();
  return <ProductPricingPanel productId={id} components={data.components} />;
}
