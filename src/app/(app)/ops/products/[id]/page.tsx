import { cache } from "react";
import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { getProductForEditor } from "@/modules/catalog/queries";
import { ProductEditor } from "@/modules/catalog/components/product-editor";
import { OPS } from "@/lib/routes";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";

const load = cache(getProductForEditor);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await load(id);
  return { title: data ? `${data.product.name} · Products` : "Product" };
}

export default async function OpsProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOpsPage();

  const { id } = await params;
  const data = await load(id);
  if (!data) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: OPS.products, label: "Products" }}
        title={data.product.name}
        badge={<StatusBadge kind="product" status={data.product.isActive ? "active" : "hidden"} />}
        meta={`/${data.product.slug} · ${data.product.category}`}
        description="Catalog copy, trial, and the pricing components each checkout is built from."
      />
      <ProductEditor product={data.product} components={data.components} />
    </div>
  );
}
