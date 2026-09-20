import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { ProductDetailsForm } from "@/modules/catalog/components/product-details-form";
import { loadProduct, productMetadata } from "./load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return productMetadata(params);
}

export default async function ProductDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOpsPage("support");
  const { id } = await params;
  const data = await loadProduct(id);
  if (!data) notFound();
  return <ProductDetailsForm product={data.product} />;
}
