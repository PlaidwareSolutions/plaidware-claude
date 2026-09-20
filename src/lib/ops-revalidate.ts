import { revalidatePath } from "next/cache";
import { OPS, TENANT } from "./routes";

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
