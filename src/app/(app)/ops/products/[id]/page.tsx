import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getSession, isOps } from "@/policy";
import { db } from "@/db";
import { productComponents, products } from "@/modules/catalog/schema";
import { asc } from "drizzle-orm";
import { ProductEditor } from "@/modules/catalog/components/product-editor";

export const metadata = { title: "Edit product" };
export const dynamic = "force-dynamic";

export default async function OpsProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOps(session)) redirect("/dashboard");

  const { id } = await params;
  const product = await db.query.products.findFirst({ where: eq(products.id, id) });
  if (!product) notFound();
  const components = await db.query.productComponents.findMany({
    where: eq(productComponents.productId, id),
    orderBy: [asc(productComponents.sortOrder)],
  });

  return (
    <ProductEditor
      product={{
        id: product.id,
        slug: product.slug,
        name: product.name,
        category: product.category,
        tagline: product.tagline,
        description: product.description,
        features: product.features,
        color: product.color,
        trialDays: product.trialDays,
        isActive: product.isActive,
      }}
      components={components.map((c) => ({
        id: c.id,
        kind: c.kind,
        name: c.name,
        description: c.description,
        amountCents: c.amountCents,
        isRequired: c.isRequired,
        isActive: c.isActive,
        synced: Boolean(c.stripePriceId),
      }))}
    />
  );
}
