import type { NextRequest } from "next/server";
import { handleRead, requireLinkedTenant } from "@/modules/partners/api-http";
import { listPartnerInvoices } from "@/modules/partners/api-queries";
import { invoicesQuerySchema } from "@/modules/partners/contracts";

/** Partner API v1 — GET /tenants/:ext/invoices?limit&offset. */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/partners/v1/tenants/[ext]/invoices">) {
  const { ext } = await ctx.params;
  return handleRead(req, async (app) => {
    const q = invoicesQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const page = await listPartnerInvoices(app, await requireLinkedTenant(app, ext), q);
    return { invoices: page.invoices, ...(page.hasMore ? { next_offset: q.offset + q.limit } : {}) };
  });
}
