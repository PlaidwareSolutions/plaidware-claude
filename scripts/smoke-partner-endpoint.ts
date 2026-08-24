/**
 * Partner read-endpoint smoke (contract §D): key auth, prefix scoping,
 * DTO shape, revocation.
 * Run with the dev server up: node --env-file=.env --import tsx scripts/smoke-partner-endpoint.ts
 */
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { user, organization, member } from "../src/modules/auth/schema";
import { products, productComponents } from "../src/modules/catalog/schema";
import { subscriptions, subscriptionItems } from "../src/modules/billing/schema";
import { partnerKeys } from "../src/modules/partners/schema";
import { mintPartnerKey, revokePartnerKey } from "../src/modules/partners/service";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  const ts = Date.now();
  const slug = `marketing-pk-smoke-${ts}`;

  const [u] = await db
    .insert(user)
    .values({
      id: `pksmoke_${ts}`,
      name: "Partner Smoke",
      email: `pksmoke_${ts}@example.com`,
      emailVerified: true,
      firstName: "Partner",
      lastName: "Smoke",
      phone: "555",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  const [org] = await db
    .insert(organization)
    .values({ id: crypto.randomUUID(), name: "PK Smoke Org", slug: `pk-smoke-${ts}`, status: "active", createdAt: new Date() })
    .returning();
  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: org.id,
    userId: u.id,
    role: "owner",
    createdAt: new Date(),
  });
  const [product] = await db
    .insert(products)
    .values({ slug, name: "PK Smoke", category: "marketing", description: "smoke" })
    .returning();
  const [baseComp] = await db
    .insert(productComponents)
    .values({ productId: product.id, kind: "recurring", interval: "month", role: "base", name: "Plan", amountCents: 1000 })
    .returning();
  const [addonComp] = await db
    .insert(productComponents)
    .values({ productId: product.id, kind: "recurring", interval: "month", name: "Video pack", amountCents: 500 })
    .returning();
  const [sub] = await db
    .insert(subscriptions)
    .values({ tenantId: org.id, productId: product.id, status: "active", currentPeriodEnd: new Date(Date.now() + 86_400_000) })
    .returning();
  await db.insert(subscriptionItems).values([
    { subscriptionId: sub.id, componentId: baseComp.id, kind: "recurring", interval: "month", name: "Plan", amountCents: 1000, status: "active" },
    { subscriptionId: sub.id, componentId: addonComp.id, kind: "recurring", interval: "month", name: "Video pack", amountCents: 500, status: "active" },
  ]);

  const { id: keyId, raw } = await mintPartnerKey(`pk-smoke-${ts}`, ["marketing-"]);
  assert(raw.startsWith("ppk_") && raw.length > 40, "raw key shape");

  const url = (prefix: string) =>
    `${BASE}/api/partners/subscriptions?product_prefix=${encodeURIComponent(prefix)}`;
  const get = (u2: string, key?: string) =>
    fetch(u2, { headers: key ? { "x-partner-key": key } : {} });

  console.log("1) authorized read returns the subscription with contract fields");
  // The smoke slug doubles as a narrower-than-grant prefix, isolating results.
  let res = await get(url(slug), raw);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert(Array.isArray(body.subscriptions) && body.subscriptions.length === 1, "one subscription");
  const dto = body.subscriptions[0];
  assert(dto.hub_subscription_id === sub.id, "hub_subscription_id");
  assert(dto.hub_org_id === org.id, "hub_org_id");
  assert(dto.product_slug === slug, "product_slug");
  assert(dto.status === "active", "status");
  assert(typeof dto.current_period_end === "string", "current_period_end ISO");
  assert(typeof dto.updated_at === "string", "updated_at present");
  assert(
    dto.addon_components.length === 1 &&
      dto.addon_components[0].name === "Video pack" &&
      dto.addon_components[0].quantity === 1,
    "addon_components excludes base",
  );

  console.log("2) missing/invalid key → 401");
  assert((await get(url(slug))).status === 401, "missing header 401");
  assert((await get(url(slug), "ppk_invalid")).status === 401, "invalid key 401");

  console.log("3) out-of-scope prefix → 403, missing prefix → 400");
  assert((await get(url("fixorata"), raw)).status === 403, "unscoped prefix 403");
  res = await get(`${BASE}/api/partners/subscriptions`, raw);
  assert(res.status === 400, `missing prefix 400 (got ${res.status})`);

  console.log("4) revoked key → 401");
  await revokePartnerKey(keyId);
  assert((await get(url(slug), raw)).status === 401, "revoked key 401");

  console.log("cleanup…");
  await db.delete(organization).where(eq(organization.id, org.id));
  await db.delete(products).where(eq(products.id, product.id));
  await db.delete(user).where(eq(user.id, u.id));
  await db.delete(partnerKeys).where(eq(partnerKeys.id, keyId));

  console.log("\n✅ PARTNER ENDPOINT SMOKE: ALL PASSED");
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("\n❌", e instanceof Error ? e.message : e);
    await pool.end();
    process.exit(1);
  });
