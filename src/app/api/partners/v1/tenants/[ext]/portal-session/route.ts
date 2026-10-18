import type { NextRequest } from "next/server";
import { handleMutation, requireLinkedTenant } from "@/modules/partners/api-http";
import { partnerPortalSession } from "@/modules/partners/api-service";
import { portalSchema } from "@/modules/partners/contracts";

/** Partner API v1 — POST /tenants/:ext/portal-session: a Stripe Billing Portal URL. */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/partners/v1/tenants/[ext]/portal-session">) {
  const { ext } = await ctx.params;
  return handleMutation(req, async ({ app, body }) => {
    const b = portalSchema.parse(body);
    const url = await partnerPortalSession(app, await requireLinkedTenant(app, ext), b.return_url);
    return { body: { url } };
  });
}
