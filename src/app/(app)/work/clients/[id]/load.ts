import { cache } from "react";
import { requireWorkClientPage } from "@/policy";
import { getClientWorkspace } from "@/modules/work/queries";

/** Page + generateMetadata share one guarded read; the guard 404s a workspace the developer isn't on. */
export const loadWorkClient = cache(async (id: string) => {
  const { viewer } = await requireWorkClientPage(id);
  return getClientWorkspace(id, viewer);
});
