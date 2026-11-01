import type { NextRequest } from "next/server";
import { handleRead } from "@/modules/partners/api-http";
import { getPartnerWorkItem } from "@/modules/partners/api-service";

/** Partner API v1 — GET /work-items/:ref: the ticket a report became (key, status, resolution, URL). */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/partners/v1/work-items/[ref]">) {
  const { ref } = await ctx.params;
  return handleRead(req, async (app) => getPartnerWorkItem(app, ref));
}
