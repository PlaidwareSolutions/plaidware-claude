import type { NextRequest } from "next/server";
import { handleRead, requireLinkedTenant } from "@/modules/partners/api-http";
import { getPartnerBillingSummary } from "@/modules/partners/api-queries";

/** Partner API v1 — GET /tenants/:ext/billing: the BillingSummary. */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/partners/v1/tenants/[ext]/billing">) {
  const { ext } = await ctx.params;
  return handleRead(req, async (app) => getPartnerBillingSummary(app, await requireLinkedTenant(app, ext), ext));
}
