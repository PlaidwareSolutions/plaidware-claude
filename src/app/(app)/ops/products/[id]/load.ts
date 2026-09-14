import { cache } from "react";
import { getProductOps } from "@/modules/catalog/queries";

export const loadProduct = cache(getProductOps);

export async function productMetadata(params: Promise<{ id: string }>, tab?: string) {
  const { id } = await params;
  const data = await loadProduct(id);
  const name = data?.product.name ?? "Product";
  return { title: tab ? `${name} · ${tab}` : `${name} · Products` };
}
