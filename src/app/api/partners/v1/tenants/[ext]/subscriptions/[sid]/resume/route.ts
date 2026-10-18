import type { NextRequest } from "next/server";
import { handleMutation, requireLinkedTenant } from "@/modules/partners/api-http";
import { getPartnerBillingSummary } from "@/modules/partners/api-queries";
import { partnerResume } from "@/modules/partners/api-service";

/** Partner API v1 — POST …/subscriptions/:sid/resume: undo a period-end cancel. */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/partners/v1/tenants/[ext]/subscriptions/[sid]/resume">) {
  const { ext, sid } = await ctx.params;
  return handleMutation(req, async ({ app, actor }) => {
    const tenantId = await requireLinkedTenant(app, ext);
    await partnerResume({ app, actor, tenantId, subscriptionId: sid });
    return { body: await getPartnerBillingSummary(app, tenantId, ext) };
  });
}
