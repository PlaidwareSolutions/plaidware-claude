import { cache } from "react";
import { getClientHeader } from "@/modules/tenancy/queries";

/** Layout + page + generateMetadata share one header read per request. */
export const loadClient = cache(getClientHeader);

export async function clientMetadata(params: Promise<{ id: string }>, tab?: string) {
  const { id } = await params;
  const client = await loadClient(id);
  const name = client?.name ?? "Client";
  return { title: tab ? `${name} · ${tab}` : name };
}
