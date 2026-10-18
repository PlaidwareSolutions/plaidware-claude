import type { NextRequest } from "next/server";
import { handleMutation, requireLinkedTenant } from "@/modules/partners/api-http";
import { partnerCheckout } from "@/modules/partners/api-service";
import { checkoutSchema } from "@/modules/partners/contracts";

/** Partner API v1 — POST /tenants/:ext/checkout: pay link for an unpaid start, or reactivation. */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/partners/v1/tenants/[ext]/checkout">) {
  const { ext } = await ctx.params;
  return handleMutation(req, async ({ app, actor, body }) => {
    const b = checkoutSchema.parse(body);
    const out = await partnerCheckout({
      app,
      actor,
      tenantId: await requireLinkedTenant(app, ext),
      productSlug: b.product_slug,
      successUrl: b.success_url,
      cancelUrl: b.cancel_url ?? null,
    });
    return { body: out };
  });
}
