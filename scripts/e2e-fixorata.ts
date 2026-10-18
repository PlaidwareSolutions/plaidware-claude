/**
 * Joint E2E: staging Hub ↔ staging Fixorata, over the real wire (Hub's
 * outbox → Fixorata's /api/webhooks/plaidware-hub → Fixorata's mirror on
 * `organizations`). Hub side runs in-process against Hub's staging DB; the
 * Fixorata side is observed READ-ONLY through its staging DB.
 *
 *  1. Hub-first new shop: ops start → activation (ignored: unknown) →
 *     provision handshake → Fixorata creates the org → Hub records the link
 *     → re-sent subscription.updated → mirror active/standard.
 *  2. Status walk on that shop: past_due → suspended → active → canceled.
 *  3. Wire rules against Fixorata: replayed delivery → duplicate, stale
 *     occurred_at → ignored, unknown event → ignored, bad signature → 401.
 *  4. Custom plan: ops start at a negotiated price → billing_plan custom.
 *  5. Trial lapse (Stripe test clock): no card at trial end → expired.
 *  6. [--existing-org <fixorata org id>] link existing: ops link, then start
 *     → handshake names the org → Fixorata links it, creates nothing.
 *  7. [--signup-org <fixorata org id>] Fixorata-first: Partner API
 *     POST /tenants (what Fixorata's signup does) → trialing mirror.
 *
 * Both optional orgs must exist in Fixorata staging with hub_org_id NULL.
 * Run (from the Hub repo; both URLs come from Railway, nothing printed):
 *   HUB=…/hub-staging-run.sh   (Hub DB + hub-web staging env)
 *   FIXORATA_DATABASE_URL=… $HUB scripts/e2e-fixorata.ts [--existing-org X] [--signup-org Y]
 * Leaves its shops in place, canceled (names start "E2E Fixorata").
 */
import { NextRequest } from "next/server";
import pg from "pg";
import { and, desc, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { getStripe } from "../src/lib/stripe";
import { organization, user } from "../src/modules/auth/schema";
import { productComponents, products } from "../src/modules/catalog/schema";
import { subscriptions } from "../src/modules/billing/schema";
import { applySubscriptionEvent, createCheckout } from "../src/modules/billing/service";
import { reactivateSubscription, suspendSubscriptionManually } from "../src/modules/billing/ar-service";
import { startSubscriptionByOps } from "../src/modules/billing/start-service";
import { webhookDeliveries } from "../src/modules/webhooks_out/schema";
import { emitSubscriptionLifecycle, runDueDeliveries } from "../src/modules/webhooks_out/service";
import { buildDeliveryHeaders, signWebhookPayload } from "../src/modules/webhooks_out/logic";
import { partnerApps, partnerKeys } from "../src/modules/partners/schema";
import { targetForApp } from "../src/modules/partners/targets";
import { externalTenantIdFor, mintPartnerKey, revokePartnerKey, setTenantLinkByOps } from "../src/modules/partners/service";
import { createTenantWithOwner, uniqueSlug } from "../src/modules/tenancy/service";
import * as tenantsRoute from "../src/app/api/partners/v1/tenants/route";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

type FxOrg = {
  id: string;
  name: string;
  billing_status: string;
  billing_plan: string | null;
  billing_status_at: Date | null;
  hub_org_id: string | null;
};

async function main() {
  if (!process.env.FIXORATA_DATABASE_URL) throw new Error("FIXORATA_DATABASE_URL is required (read-only use)");
  const fx = new pg.Pool({ connectionString: process.env.FIXORATA_DATABASE_URL, max: 2 });
  const fxOrg = async (where: string, v: string) =>
    (await fx.query<FxOrg>(`select id, name, billing_status, billing_plan, billing_status_at, hub_org_id from organizations where ${where} = $1`, [v])).rows[0] ?? null;

  const app = await db.query.partnerApps.findFirst({ where: eq(partnerApps.name, "fixorata") });
  assert(app && app.status === "active", "fixorata partner app active on this Hub");
  const target = targetForApp(app);
  assert(target.lifecycleUrl && target.secret, "partner app has a webhook URL and secret");
  const product = await db.query.products.findFirst({ where: eq(products.slug, "fixorata") });
  const base = product
    ? await db.query.productComponents.findFirst({ where: and(eq(productComponents.productId, product.id), eq(productComponents.role, "base")) })
    : null;
  assert(product && base && base.amountCents === 3500 && product.trialDays === 30, "fixorata product aligned ($35, 30-day trial)");
  const stripe = getStripe();
  const run = Date.now().toString(36);
  const stripeSubs: string[] = [];

  /** Sweep (the staging worker may win the race — either is fine) until `check` passes. */
  async function until<T>(label: string, check: () => Promise<T | null | undefined | false>, seconds = 120): Promise<T> {
    for (let i = 0; i < seconds / 3; i++) {
      await runDueDeliveries().catch(() => {});
      const v = await check();
      if (v) return v as T;
      await wait(3000);
    }
    const dead = await db.query.webhookDeliveries.findMany({
      where: eq(webhookDeliveries.partnerAppId, app!.id),
      orderBy: [desc(webhookDeliveries.updatedAt)],
      limit: 3,
    });
    throw new Error(`timed out: ${label}. Latest deliveries: ${dead.map((d) => `${d.event}=${d.status} ${d.lastError ?? ""}`).join(" | ")}`);
  }
  const mirror = (hubOrgId: string, status: string, label: string) =>
    until(label, async () => {
      const o = await fxOrg("hub_org_id", hubOrgId);
      return o && o.billing_status === status ? o : null;
    });

  async function hubShop(label: string) {
    const [u] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(), name: "E2E Owner", email: `e2e-fixorata-${label}-${run}@example.com`, emailVerified: false,
        firstName: "E2E", lastName: "Owner", phone: "+15550000000", platformRole: "customer", createdAt: new Date(), updatedAt: new Date(),
      })
      .returning();
    const org = await createTenantWithOwner({ name: `E2E Fixorata ${label} ${run}`, slug: await uniqueSlug(`e2e-fixorata-${label}-${run}`), ownerUserId: u.id });
    return { org, owner: u };
  }
  const ops = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.platformRole, "ops_admin"))
    .limit(1)
    .then((r) => r[0]);
  assert(ops, "an ops admin exists to attribute ops actions to");
  const opsStart = async (tenantId: string, ownerEmail: string, cents: number) => {
    const r = await startSubscriptionByOps({
      tenantId, productId: product!.id, items: [{ componentId: base!.id, amountCents: cents, quantity: 1 }],
      collection: { mode: "send_invoice", daysUntilDue: 7 }, skipTrial: true, persistOverrides: cents !== base!.amountCents,
      actorUserId: ops.id, contact: { email: ownerEmail, name: "E2E Owner" },
    });
    if (r.stripeSubscriptionId) stripeSubs.push(r.stripeSubscriptionId);
    return r;
  };
  const setStatus = async (subId: string, status: "past_due" | "active" | "canceled") => {
    await db.update(subscriptions).set({ status }).where(eq(subscriptions.id, subId));
  };

  // ---- 1. Hub-first new shop ---------------------------------------------
  console.log("1) Hub-first: ops start → handshake creates the Fixorata org → mirror active");
  const s1 = await hubShop("hubfirst");
  const r1 = await opsStart(s1.org.id, s1.owner.email, 3500);
  const ext1 = await until("Hub records the link from the handshake reply", () =>
    externalTenantIdFor(app.id, s1.org.id),
  );
  const o1 = await mirror(s1.org.id, "active", "Fixorata mirror active after the re-sent update");
  assert(o1.id === ext1 && o1.billing_plan === "standard", `Fixorata org ${o1.id} linked, plan standard`);
  console.log(`   Fixorata org ${o1.id} "${o1.name}"`);

  // ---- 2. Status walk ------------------------------------------------------
  console.log("2) status walk: past_due → suspended → active → canceled");
  await setStatus(r1.subscriptionId, "past_due");
  await emitSubscriptionLifecycle(r1.subscriptionId, "subscription.past_due");
  await mirror(s1.org.id, "past_due", "mirror past_due");
  await suspendSubscriptionManually(r1.subscriptionId, { actorUserId: ops.id, note: "E2E hold" });
  await mirror(s1.org.id, "suspended", "mirror suspended");
  await reactivateSubscription(r1.subscriptionId, { actorUserId: ops.id });
  await mirror(s1.org.id, "active", "mirror active again");
  const before = (await fxOrg("hub_org_id", s1.org.id))!.billing_status_at;

  // ---- 3. Wire rules ---------------------------------------------------------
  console.log("3) wire rules: duplicate, stale, unknown event, bad signature");
  const delivered = await db.query.webhookDeliveries.findFirst({
    where: and(eq(webhookDeliveries.subscriptionId, r1.subscriptionId), eq(webhookDeliveries.status, "delivered"), eq(webhookDeliveries.kind, "lifecycle")),
    orderBy: [desc(webhookDeliveries.createdAt)],
  });
  assert(delivered, "a delivered lifecycle row to replay");
  const post = async (event: string, deliveryId: string, body: unknown, secret = target.secret!) => {
    const raw = JSON.stringify(body);
    const t = Math.floor(Date.now() / 1000);
    const res = await fetch(target.lifecycleUrl!, {
      method: "POST",
      headers: buildDeliveryHeaders({ event, deliveryId, timestampSeconds: t, signature: signWebhookPayload(secret, t, raw) }),
      body: raw,
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };
  let w = await post(delivered.event, delivered.deliveryId, { event: delivered.event, data: delivered.payload });
  assert(w.status === 200 && w.body?.status === "duplicate", `replay → duplicate (got ${w.status} ${JSON.stringify(w.body)})`);
  w = await post("subscription.canceled", crypto.randomUUID(), {
    event: "subscription.canceled",
    data: { ...delivered.payload, status: "canceled", billing_status: "canceled", occurred_at: new Date(Date.now() - 86_400_000).toISOString() },
  });
  assert(w.status === 200 && w.body?.status === "ignored", `stale occurred_at → ignored (got ${JSON.stringify(w.body)})`);
  assert((await fxOrg("hub_org_id", s1.org.id))!.billing_status === "active", "stale event changed nothing");
  w = await post("subscription.teleported", crypto.randomUUID(), { event: "subscription.teleported", data: delivered.payload });
  assert(w.status === 200 && w.body?.status === "ignored", `unknown event → ignored (got ${JSON.stringify(w.body)})`);
  w = await post("subscription.updated", crypto.randomUUID(), { event: "subscription.updated", data: delivered.payload }, "pws_wrong_secret_0000000000000000");
  assert(w.status === 401, `bad signature → 401 (got ${w.status})`);
  assert(String((await fxOrg("hub_org_id", s1.org.id))!.billing_status_at) === String(before), "rejected posts left the mirror alone");

  await setStatus(r1.subscriptionId, "canceled");
  await emitSubscriptionLifecycle(r1.subscriptionId, "subscription.canceled");
  await mirror(s1.org.id, "canceled", "mirror canceled");

  // ---- 4. Custom plan --------------------------------------------------------
  console.log("4) custom plan: negotiated $60 → billing_plan custom");
  const s4 = await hubShop("custom");
  await opsStart(s4.org.id, s4.owner.email, 6000);
  const o4 = await mirror(s4.org.id, "active", "custom shop mirrored active");
  assert(o4.billing_plan === "custom", `billing_plan custom (got ${o4.billing_plan})`);

  // ---- 5. Trial lapse (test clock) ------------------------------------------
  console.log("5) trial lapse: no card at trial end → expired (test clock, ~2 min)");
  const s5 = await hubShop("lapse");
  const now = Math.floor(Date.now() / 1000);
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: now, name: `e2e-fixorata-${run}` });
  try {
    const cust = await stripe.customers.create({ email: s5.owner.email, name: s5.org.name, test_clock: clock.id, metadata: { tenant_id: s5.org.id } });
    await db.update(organization).set({ stripeCustomerId: cust.id }).where(eq(organization.id, s5.org.id));
    const co = await createCheckout({
      tenantId: s5.org.id, productId: product.id, componentIds: [], contact: { email: s5.owner.email, name: "E2E Owner" },
      userId: null, trialEndWithoutCard: "cancel",
    });
    assert(co.status === "trialing", "trial started without a card");
    await mirror(s5.org.id, "trialing", "lapse shop mirrored trialing");
    await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: now + 31 * 86_400 });
    for (let i = 0; i < 60 && (await stripe.testHelpers.testClocks.retrieve(clock.id)).status !== "ready"; i++) await wait(2000);
    await applySubscriptionEvent(await stripe.subscriptions.retrieve(co.stripeSubscriptionId!));
    await mirror(s5.org.id, "expired", "mirror expired after the lapse");
  } finally {
    await stripe.testHelpers.testClocks.del(clock.id).catch(() => {});
  }

  // ---- 6. Link existing (optional) ------------------------------------------
  const existing = arg("--existing-org");
  if (existing) {
    console.log(`6) link existing Fixorata org ${existing}: ops link, then start`);
    const fx6 = await fxOrg("id", existing);
    assert(fx6 && !fx6.hub_org_id, "the existing Fixorata org exists and is unlinked");
    const s6 = await hubShop("existing");
    await setTenantLinkByOps({ partnerAppId: app.id, tenantId: s6.org.id, externalTenantId: existing, actorUserId: ops.id });
    await opsStart(s6.org.id, s6.owner.email, 3500);
    const o6 = await mirror(s6.org.id, "active", "existing org mirrored active");
    assert(o6.id === existing, "Fixorata linked the named org, created nothing");
  } else {
    console.log("6) --existing-org not given — skipping link-existing");
  }

  // ---- 7. Fixorata-first (optional) ------------------------------------------
  const signup = arg("--signup-org");
  if (signup) {
    console.log(`7) Fixorata-first for org ${signup}: Partner API POST /tenants`);
    const fx7 = await fxOrg("id", signup);
    assert(fx7 && !fx7.hub_org_id, "the signup org exists in Fixorata and is unlinked");
    const key = await mintPartnerKey(`e2e-${run}`, app.productPrefixes, app.id);
    try {
      const req = new NextRequest("http://hub.local/api/partners/v1/tenants", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-partner-key": key.raw,
          "x-partner-actor": JSON.stringify({ external_user_id: "e2e", email: `e2e-signup-${run}@example.com`, name: "E2E", role: "owner" }),
          "idempotency-key": `e2e-${run}`,
        },
        body: JSON.stringify({
          external_tenant_id: signup, name: fx7.name, owner: { email: `e2e-signup-${run}@example.com`, name: "E2E Owner" },
          success_url: `${new URL(target.lifecycleUrl!).origin}/billing?paid=1`,
        }),
      });
      const res = await tenantsRoute.POST(req);
      const body = (await res.json()) as { hub_org_id: string; billing_status: string; payment_url: string | null };
      assert(res.status === 201 && body.billing_status === "trialing" && body.payment_url === null, `trial, no card (got ${JSON.stringify(body)})`);
      const o7 = await mirror(body.hub_org_id, "trialing", "signup org mirrored trialing");
      assert(o7.id === signup, "mirror landed on the signup org");
    } finally {
      await revokePartnerKey(key.id);
      await db.delete(partnerKeys).where(eq(partnerKeys.id, key.id));
    }
  } else {
    console.log("7) --signup-org not given — skipping Fixorata-first");
  }

  console.log("cleanup: canceling Stripe subscriptions (shops stay, canceled)…");
  for (const id of stripeSubs) await stripe.subscriptions.cancel(id).catch(() => {});
  await fx.end();
  console.log("\n✅ FIXORATA E2E: ALL PASSED");
  await pool.end();
}

main().catch(async (e) => {
  console.error("\n❌", e instanceof Error ? e.message : e);
  await pool.end().catch(() => {});
  process.exit(1);
});
