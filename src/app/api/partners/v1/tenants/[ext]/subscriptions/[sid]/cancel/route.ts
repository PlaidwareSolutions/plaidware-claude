import type { NextRequest } from "next/server";
import { handleMutation, requireLinkedTenant } from "@/modules/partners/api-http";
import { getPartnerBillingSummary } from "@/modules/partners/api-queries";
import { partnerCancel } from "@/modules/partners/api-service";
import { cancelSchema } from "@/modules/partners/contracts";

/** Partner API v1 — POST …/subscriptions/:sid/cancel (at period end by default). */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/partners/v1/tenants/[ext]/subscriptions/[sid]/cancel">) {
  const { ext, sid } = await ctx.params;
  return handleMutation(req, async ({ app, actor, body }) => {
    const b = cancelSchema.parse(body);
    const tenantId = await requireLinkedTenant(app, ext);
    await partnerCancel({ app, actor, tenantId, subscriptionId: sid, atPeriodEnd: b.at_period_end, reason: b.reason ?? null });
    return { body: await getPartnerBillingSummary(app, tenantId, ext) };
  });
}
