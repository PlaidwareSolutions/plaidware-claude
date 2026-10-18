import type { NextRequest } from "next/server";
import { handleMutation, requireLinkedTenant } from "@/modules/partners/api-http";
import { getPartnerBillingSummary } from "@/modules/partners/api-queries";
import { partnerChangeItems } from "@/modules/partners/api-service";
import { itemsSchema } from "@/modules/partners/contracts";

/** Partner API v1 — POST …/subscriptions/:sid/items: set add-on quantities. */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/partners/v1/tenants/[ext]/subscriptions/[sid]/items">) {
  const { ext, sid } = await ctx.params;
  return handleMutation(req, async ({ app, actor, body }) => {
    const b = itemsSchema.parse(body);
    const tenantId = await requireLinkedTenant(app, ext);
    await partnerChangeItems({
      app,
      actor,
      tenantId,
      subscriptionId: sid,
      changes: b.changes.map((c) => ({ componentId: c.component_id, quantity: c.quantity })),
    });
    return { body: await getPartnerBillingSummary(app, tenantId, ext) };
  });
}
