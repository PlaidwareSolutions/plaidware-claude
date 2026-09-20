import { notFound, redirect } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { OPS } from "@/lib/routes";
import { resolveDnsDefaults } from "@/modules/provisioning/defaults";
import { ProductDefaultsForm } from "@/modules/catalog/components/product-defaults-form";
import { loadProduct, productMetadata } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return productMetadata(params, "Provisioning defaults");
}

export default async function ProductDefaultsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOpsPage("support");
  const { id } = await params;
  const data = await loadProduct(id);
  if (!data) notFound();
  if (data.product.isMarketing) redirect(OPS.product(id)); // MHub owns provisioning for marketing-*
  return <ProductDefaultsForm product={data.product} platform={resolveDnsDefaults(null)} />;
}
