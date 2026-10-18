import type { NextRequest } from "next/server";
import { handleMutation } from "@/modules/partners/api-http";
import { startPartnerTenant } from "@/modules/partners/api-service";
import { startTenantSchema } from "@/modules/partners/contracts";

/**
 * Partner API v1 (docs/PARTNER-API.md) — POST /tenants: create or find the
 * Hub workspace for a partner tenant and return a pay link for its
 * subscription. Idempotent on external_tenant_id as well as Idempotency-Key.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleMutation(req, async ({ app, actor, body }) => {
    const b = startTenantSchema.parse(body);
    const out = await startPartnerTenant({
      app,
      actor,
      externalTenantId: b.external_tenant_id,
      name: b.name,
      owner: b.owner,
      productSlug: b.product_slug,
      successUrl: b.success_url,
      cancelUrl: b.cancel_url ?? null,
    });
    return { status: 201, body: out };
  });
}
