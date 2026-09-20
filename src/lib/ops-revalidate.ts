import { revalidatePath } from "next/cache";
import { OPS, TENANT, WORK } from "./routes";

/**
 * Server-action helpers: one call refreshes every surface that shows a
 * client's data, so no module has to remember the current route layout.
 */
export function revalidateClientViews(tenantId?: string) {
  revalidatePath(OPS.home);
  revalidatePath(OPS.clients);
  revalidatePath(OPS.billing);
  revalidatePath(OPS.subscriptions);
  if (tenantId) revalidatePath(OPS.client(tenantId), "layout");
  else revalidatePath(`${OPS.clients}/[id]`, "layout");
}

export function revalidateOps(...paths: string[]) {
  for (const p of paths) revalidatePath(p);
}

export function revalidateTenantViews() {
  for (const p of Object.values(TENANT)) if (typeof p === "string") revalidatePath(p);
}

/** Every surface that shows one account: the Access table, the user's page (all tabs), the ops home counts. */
export function revalidateUserViews(userId: string) {
  revalidatePath(OPS.access);
  revalidatePath(OPS.user(userId), "layout");
  revalidatePath(OPS.home);
}

/** Every work-area surface that shows a board's items: overview, my work, the board's tab group, one item. */
export function revalidateWorkViews(slug?: string, number?: number) {
  revalidatePath(WORK.home);
  revalidatePath(WORK.my);
  if (slug) revalidatePath(WORK.board(slug), "layout");
  if (slug && number != null) revalidatePath(WORK.item(slug, number));
}
