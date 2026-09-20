import { cache } from "react";
import { getPlatformUser } from "@/modules/access/queries";

/** Layout + page + generateMetadata share one account read per request. */
export const loadUser = cache(getPlatformUser);

export async function userMetadata(params: Promise<{ id: string }>, tab?: string) {
  const { id } = await params;
  const u = await loadUser(id);
  const name = u?.name ?? "User";
  return { title: tab ? `${name} · ${tab}` : name };
}
