import type { NextRequest } from "next/server";
import { handleMutation, requireLinkedTenant } from "@/modules/partners/api-http";
import { getPartnerBillingSummary } from "@/modules/partners/api-queries";
import { updatePartnerTenant } from "@/modules/partners/api-service";
import { updateTenantSchema } from "@/modules/partners/contracts";

/** Partner API v1 — PATCH /tenants/:ext: keep the shop name and billing contact current. */

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/partners/v1/tenants/[ext]">) {
  const { ext } = await ctx.params;
  return handleMutation(req, async ({ app, actor, body }) => {
    const b = updateTenantSchema.parse(body);
    const tenantId = await requireLinkedTenant(app, ext);
    await updatePartnerTenant({ app, actor, tenantId, name: b.name, billingEmail: b.billing_email, billingName: b.billing_name });
    return { body: await getPartnerBillingSummary(app, tenantId, ext) };
  });
}
