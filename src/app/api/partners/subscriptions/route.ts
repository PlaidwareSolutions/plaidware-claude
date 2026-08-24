import { z } from "zod";
import { partnerKeyAllows } from "@/modules/partners/logic";
import { listPartnerSubscriptions } from "@/modules/partners/queries";
import { resolvePartnerKey } from "@/modules/partners/service";

/**
 * Read-only partner feed (integration contract §D). External contract — the
 * one consumer today is MHub reconciling marketing-* subscriptions. Auth is
 * a hashed partner key (X-Partner-Key) scoped by product-prefix allowlist.
 */

export const dynamic = "force-dynamic";

const MAX_PAGE = 500;

const querySchema = z.object({
  // Interpolated into a LIKE pattern — the character class is the injection guard.
  product_prefix: z.string().regex(/^[a-z0-9-]{1,64}$/),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(MAX_PAGE),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(req: Request) {
  const rawKey = req.headers.get("x-partner-key");
  if (!rawKey) {
    return Response.json({ error: "Missing X-Partner-Key header" }, { status: 401 });
  }
  const key = await resolvePartnerKey(rawKey);
  if (!key) {
    return Response.json({ error: "Invalid or revoked key" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json({ error: "Invalid or missing product_prefix" }, { status: 400 });
  }
  const { product_prefix, limit, offset } = parsed.data;
  if (!partnerKeyAllows(key.productPrefixes, product_prefix)) {
    return Response.json({ error: "Key is not scoped for this product prefix" }, { status: 403 });
  }

  try {
    const { subscriptions, hasMore } = await listPartnerSubscriptions(product_prefix, {
      limit,
      offset,
    });
    return Response.json({
      subscriptions,
      ...(hasMore ? { next_offset: offset + limit } : {}),
    });
  } catch (e) {
    console.error("[partners] subscriptions feed failed:", e);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
