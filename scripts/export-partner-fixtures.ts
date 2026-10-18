/**
 * Export REAL Partner API responses and signed webhooks as JSON fixtures for
 * a partner app's mock (Fixorata's server/hub-mock.ts). Every scenario runs
 * through the actual route handlers against the local DB + Stripe TEST mode:
 * trialing (no card / card), active, cancel scheduled, suspended, expired
 * (test clock), custom plan (ops start, negotiated price), canceled, pending,
 * plus start/checkout/portal responses, error envelopes, and the outbox's
 * webhook bodies signed with a published fixture secret.
 *
 * Run: node --env-file=.env --import tsx scripts/export-partner-fixtures.ts <out dir>
 * Needs the local `fixorata` partner app and an aligned fixorata product
 * (scripts/align-fixorata-pricing.ts). Leaves its fixture tenants in the
 * local DB (prefix "Fixture —") so the data can be inspected.
 */
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db";
import { getStripe } from "../src/lib/stripe";
import { organization, user } from "../src/modules/auth/schema";
import { productComponents, products } from "../src/modules/catalog/schema";
import { subscriptions } from "../src/modules/billing/schema";
import { applyInvoiceEvent, applySubscriptionEvent } from "../src/modules/billing/service";
import { suspendSubscriptionManually } from "../src/modules/billing/ar-service";
import { startSubscriptionByOps } from "../src/modules/billing/start-service";
import { webhookDeliveries } from "../src/modules/webhooks_out/schema";
import { partnerApps, partnerKeys } from "../src/modules/partners/schema";
import { linkPartnerTenant, mintPartnerKey, revokePartnerKey } from "../src/modules/partners/service";
import { completePayLink, getPayPage } from "../src/modules/partners/api-service";
import { forgetStripeFacts } from "../src/modules/partners/api-queries";
import { createTenantWithOwner, uniqueSlug } from "../src/modules/tenancy/service";
import * as tenantsRoute from "../src/app/api/partners/v1/tenants/route";
import * as tenantRoute from "../src/app/api/partners/v1/tenants/[ext]/route";
import * as billingRoute from "../src/app/api/partners/v1/tenants/[ext]/billing/route";
import * as invoicesRoute from "../src/app/api/partners/v1/tenants/[ext]/invoices/route";
import * as checkoutRoute from "../src/app/api/partners/v1/tenants/[ext]/checkout/route";
import * as portalRoute from "../src/app/api/partners/v1/tenants/[ext]/portal-session/route";
import * as itemsRoute from "../src/app/api/partners/v1/tenants/[ext]/subscriptions/[sid]/items/route";
import * as cancelRoute from "../src/app/api/partners/v1/tenants/[ext]/subscriptions/[sid]/cancel/route";

/** Published on purpose: fixtures are signed with it so a mock can verify them. Never a real secret. */
const FIXTURE_SECRET = "pws_fixture_not_a_real_secret_0000000000000000";
const ORIGIN = "http://localhost:5000";
const ACTOR = { external_user_id: "fx-user-owner", email: "owner@fixture-shop.example", name: "Fixture Owner", role: "owner" };

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const stripe = getStripe();
const out = process.argv[2];
if (!out) throw new Error("Usage: export-partner-fixtures.ts <out dir>");
mkdirSync(join(out, "responses"), { recursive: true });
mkdirSync(join(out, "webhooks"), { recursive: true });
const save = (path: string, data: unknown) => writeFileSync(join(out, path), JSON.stringify(data, null, 2) + "\n");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const app = await db.query.partnerApps.findFirst({ where: eq(partnerApps.name, "fixorata") });
  if (!app) throw new Error("No local fixorata partner app");
  const product = await db.query.products.findFirst({ where: eq(products.slug, "fixorata") });
  const base = product
    ? await db.query.productComponents.findFirst({ where: and(eq(productComponents.productId, product.id), eq(productComponents.role, "base")) })
    : null;
  if (!product || !base || product.trialDays !== 30 || base.amountCents !== 3500) throw new Error("Run align-fixorata-pricing.ts --apply first");
  const opsAdmin = await db.query.user.findFirst({ where: eq(user.email, "walkthrough-admin@example.com") });
  if (!opsAdmin) throw new Error("Local walkthrough ops admin missing");

  const key = await mintPartnerKey("fixture-export", app.productPrefixes, app.id);
  const run = Date.now().toString(36);
  let n = 0;
  const headers = (method: string, extra: Record<string, string> = {}) => ({
    "content-type": "application/json",
    "x-partner-key": key.raw,
    ...(method === "GET" ? {} : { "x-partner-actor": JSON.stringify(ACTOR), "idempotency-key": `fx-${run}-${++n}` }),
    ...extra,
  });
  const call = async (method: string, path: string, handler: (req: NextRequest, ctx: never) => Promise<Response>, params: Record<string, string> = {}, body?: unknown, extra: Record<string, string> = {}) => {
    const req = new NextRequest(`http://hub.local/api/partners/v1${path}`, {
      method,
      headers: headers(method, extra),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await handler(req, { params: Promise.resolve(params) } as never);
    return { status: res.status, body: (await res.json()) as Json };
  };
  const ext = (state: string) => `fx-fixture-${state}-${run}`;
  const start = (e: string, name: string) =>
    call("POST", "/tenants", tenantsRoute.POST, {}, {
      external_tenant_id: e,
      name: `Fixture — ${name}`,
      owner: { email: `fixture-${name.toLowerCase().replace(/\W+/g, "-")}-${run}@example.com`, name: "Fixture Owner" },
      success_url: `${ORIGIN}/billing?paid=1`,
      cancel_url: `${ORIGIN}/billing`,
    });
  const subOf = async (tenantId: string) =>
    (await db.query.subscriptions.findMany({ where: eq(subscriptions.tenantId, tenantId), orderBy: [asc(subscriptions.subscribedAt)] })).at(-1)!;
  /** What Stripe's customer.subscription.* webhook does on staging: sync period/trial/status, then read. */
  const summary = async (ext: string) => {
    const tenantId = (await db.query.partnerTenantLinks.findFirst({ where: (t, { eq: e }) => e(t.externalTenantId, ext) }))?.tenantId;
    const latest = tenantId ? await subOf(tenantId) : null;
    if (latest?.stripeSubscriptionId) await applySubscriptionEvent(await stripe.subscriptions.retrieve(latest.stripeSubscriptionId));
    forgetStripeFacts((await db.query.organization.findFirst({ where: eq(organization.id, tenantId ?? "") }))?.stripeCustomerId);
    return (await call("GET", `/tenants/${ext}/billing`, billingRoute.GET, { ext })).body;
  };
  const waitDefaultPm = async (stripeSubId: string) => {
    for (let i = 0; i < 20; i++) {
      if ((await stripe.subscriptions.retrieve(stripeSubId)).default_payment_method) return;
      await wait(1000);
    }
    throw new Error("card never became the subscription default");
  };
  const settle = async (stripeSubId: string) => {
    const ss = await stripe.subscriptions.retrieve(stripeSubId, { expand: ["latest_invoice"] });
    await applyInvoiceEvent(ss.latest_invoice as never, "invoice.paid");
    await applySubscriptionEvent(await stripe.subscriptions.retrieve(stripeSubId));
  };
  const tenants: string[] = [];
  const manifest: { file: string; what: string }[] = [];
  const keep = (file: string, what: string, data: unknown) => {
    save(file, data);
    manifest.push({ file, what });
  };

  // ---- 1. trialing, no card -------------------------------------------------
  console.log("trialing (no card)…");
  const e1 = ext("trial");
  const r1 = await start(e1, "Trial no card");
  keep("responses/post-tenants--trial-started.json", "201 from POST /tenants: a new shop, trialing, no card, no pay link", r1);
  tenants.push(r1.body.hub_org_id);
  keep("responses/billing--trialing-no-card.json", "BillingSummary: 30-day trial, $35 standard, no card", await summary(e1));

  // ---- 2. trialing with a card ----------------------------------------------
  console.log("trialing (card added)…");
  const e2 = ext("trialcard");
  const r2 = await start(e2, "Trial with card");
  tenants.push(r2.body.hub_org_id);
  const addCard = await call("POST", `/tenants/${e2}/checkout`, checkoutRoute.POST, { ext: e2 }, { success_url: `${ORIGIN}/billing?paid=1`, cancel_url: `${ORIGIN}/billing` });
  keep("responses/post-checkout--trial-add-card.json", "POST /checkout during a trial: a pay link in save-card mode", addCard);
  const t2 = String(addCard.body.payment_url).split("/pay/")[1];
  const page2 = await getPayPage(t2);
  if (page2.state !== "pay") throw new Error("pay page not ready");
  await stripe.setupIntents.confirm(page2.clientSecret.split("_secret_")[0], { payment_method: "pm_card_visa" });
  const s2 = await subOf(r2.body.hub_org_id);
  await waitDefaultPm(s2.stripeSubscriptionId!);
  await completePayLink(t2);
  keep("responses/billing--trialing-with-card.json", "BillingSummary: trial with a card on file (Visa 4242)", await summary(e2));
  const again = await call("POST", `/tenants/${e2}/checkout`, checkoutRoute.POST, { ext: e2 }, { success_url: `${ORIGIN}/billing` });
  keep("responses/post-checkout--nothing-owed.json", "POST /checkout when nothing is owed: payment_url null", again);

  // ---- 3. canceled → pending → active → cancel scheduled → suspended ------
  console.log("canceled → pending → active → cancel scheduled → suspended…");
  const e3 = ext("active");
  const r3 = await start(e3, "Active shop");
  tenants.push(r3.body.hub_org_id);
  const trialSub = await subOf(r3.body.hub_org_id);
  const canceled = await call("POST", `/tenants/${e3}/subscriptions/${trialSub.id}/cancel`, cancelRoute.POST, { ext: e3, sid: trialSub.id }, { at_period_end: false, reason: "fixture" });
  keep("responses/billing--canceled.json", "BillingSummary after an immediate cancel (response of POST …/cancel with at_period_end false)", canceled.body);
  const react = await call("POST", `/tenants/${e3}/checkout`, checkoutRoute.POST, { ext: e3 }, { success_url: `${ORIGIN}/billing?paid=1`, cancel_url: `${ORIGIN}/billing` });
  keep("responses/post-checkout--reactivate.json", "POST /checkout after canceled/expired: pending, pay link charging $35 now (no second trial)", react);
  keep("responses/billing--pending.json", "BillingSummary while a reactivation awaits its first payment", await summary(e3));
  const t3 = String(react.body.payment_url).split("/pay/")[1];
  const page3 = await getPayPage(t3);
  if (page3.state !== "pay") throw new Error("reactivation pay page not ready");
  await stripe.paymentIntents.confirm(page3.clientSecret.split("_secret_")[0], { payment_method: "pm_card_visa" });
  const s3 = await subOf(r3.body.hub_org_id);
  await settle(s3.stripeSubscriptionId!);
  await waitDefaultPm(s3.stripeSubscriptionId!);
  await completePayLink(t3);
  keep("responses/billing--active.json", "BillingSummary: active, paid, card on file, next charge", await summary(e3));
  keep("responses/invoices--page.json", "GET /invoices?limit=1 (with next_offset)", (await call("GET", `/tenants/${e3}/invoices?limit=1`, invoicesRoute.GET, { ext: e3 })).body);
  keep("responses/post-portal-session.json", "POST /portal-session: Stripe Billing Portal URL (single use, short-lived)",
    await call("POST", `/tenants/${e3}/portal-session`, portalRoute.POST, { ext: e3 }, { return_url: `${ORIGIN}/billing` }));
  const scheduled = await call("POST", `/tenants/${e3}/subscriptions/${s3.id}/cancel`, cancelRoute.POST, { ext: e3, sid: s3.id }, { at_period_end: true, reason: "fixture" });
  keep("responses/billing--cancel-scheduled.json", "BillingSummary: still active, cancel_at_period_end true, no next charge", scheduled.body);
  const { partnerResume } = await import("../src/modules/partners/api-service");
  await partnerResume({ app, actor: { externalUserId: ACTOR.external_user_id, email: ACTOR.email, name: ACTOR.name, role: ACTOR.role }, tenantId: r3.body.hub_org_id, subscriptionId: s3.id });
  await suspendSubscriptionManually(s3.id, { actorUserId: opsAdmin.id, note: "Fixture: manual hold by Plaidware ops" });
  keep("responses/billing--suspended.json", "BillingSummary: suspended by an ops manual hold (suspension object filled)", await summary(e3));
  keep("responses/error--validation-base-charge.json", "400: the base charge isn't an add-on",
    await call("POST", `/tenants/${e3}/subscriptions/${s3.id}/items`, itemsRoute.POST, { ext: e3, sid: s3.id }, { changes: [{ component_id: base.id, quantity: 2 }] }));
  await db.update(organization).set({ status: "suspended" }).where(eq(organization.id, r3.body.hub_org_id));
  keep("responses/error--workspace-locked.json", "409: Hub workspace suspended/inactive refuses cancel/items/resume",
    await call("POST", `/tenants/${e3}/subscriptions/${s3.id}/cancel`, cancelRoute.POST, { ext: e3, sid: s3.id }, { at_period_end: true }));
  await db.update(organization).set({ status: "active" }).where(eq(organization.id, r3.body.hub_org_id));

  // ---- 4. expired (trial lapsed with no card) — Stripe test clock ------------
  console.log("expired (test clock, ~1 min)…");
  const e4 = ext("expired");
  const owner4 = await db.insert(user).values({
    id: crypto.randomUUID(), name: "Fixture Owner", email: `fixture-expired-${run}@example.com`, emailVerified: false,
    firstName: "Fixture", lastName: "Owner", phone: "+15550000000", platformRole: "customer", createdAt: new Date(), updatedAt: new Date(),
  }).returning();
  const org4 = await createTenantWithOwner({ name: "Fixture — Expired trial", slug: await uniqueSlug(`fixture-expired-${run}`), ownerUserId: owner4[0].id });
  tenants.push(org4.id);
  await linkPartnerTenant({ partnerAppId: app.id, tenantId: org4.id, externalTenantId: e4, linkedBy: "partner_api" });
  const now = Math.floor(Date.now() / 1000);
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: now, name: `fixture-expired-${run}` });
  const cust = await stripe.customers.create({ email: owner4[0].email, name: org4.name, test_clock: clock.id, metadata: { tenant_id: org4.id } });
  await db.update(organization).set({ stripeCustomerId: cust.id }).where(eq(organization.id, org4.id));
  await call("POST", `/tenants/${e4}/checkout`, checkoutRoute.POST, { ext: e4 }, { success_url: `${ORIGIN}/billing` });
  // /checkout during a trial mints a save-card link; the trial itself started without a card.
  const s4 = await subOf(org4.id);
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: now + 31 * 86_400 });
  for (let i = 0; i < 60; i++) {
    if ((await stripe.testHelpers.testClocks.retrieve(clock.id)).status === "ready") break;
    await wait(2000);
  }
  await applySubscriptionEvent(await stripe.subscriptions.retrieve(s4.stripeSubscriptionId!));
  keep("responses/billing--expired.json", "BillingSummary: the 30-day trial ended with no card → expired (no invoice, no dunning)", await summary(e4));
  await stripe.testHelpers.testClocks.del(clock.id).catch(() => {});

  // ---- 5. custom plan (ops start: negotiated $60, no trial, emailed invoice)
  console.log("custom plan…");
  const e5 = ext("custom");
  const owner5 = await db.insert(user).values({
    id: crypto.randomUUID(), name: "Fixture Owner", email: `fixture-custom-${run}@example.com`, emailVerified: false,
    firstName: "Fixture", lastName: "Owner", phone: "+15550000000", platformRole: "customer", createdAt: new Date(), updatedAt: new Date(),
  }).returning();
  const org5 = await createTenantWithOwner({ name: "Fixture — Multi-store (custom)", slug: await uniqueSlug(`fixture-custom-${run}`), ownerUserId: owner5[0].id });
  tenants.push(org5.id);
  await linkPartnerTenant({ partnerAppId: app.id, tenantId: org5.id, externalTenantId: e5, linkedBy: `ops:${opsAdmin.id}` });
  await startSubscriptionByOps({
    tenantId: org5.id,
    productId: product.id,
    items: [{ componentId: base.id, amountCents: 6000, quantity: 1 }],
    collection: { mode: "send_invoice", daysUntilDue: 7 },
    skipTrial: true,
    persistOverrides: true,
    actorUserId: opsAdmin.id,
    contact: { email: owner5[0].email, name: "Fixture Owner" },
  });
  keep("responses/billing--custom-plan.json", "BillingSummary: ops-started custom plan ($60, no trial, invoices emailed — no card)", await summary(e5));
  keep("responses/patch-tenant.json", "PATCH /tenants/:ext (name + billing contact) → BillingSummary",
    await call("PATCH", `/tenants/${e5}`, tenantRoute.PATCH, { ext: e5 }, { name: "Fixture — Multi-store (renamed)", billing_email: "books@fixture-shop.example" }));

  // ---- errors -----------------------------------------------------------------
  keep("responses/error--unauthorized.json", "401: missing or bad X-Partner-Key",
    await call("GET", `/tenants/${e1}/billing`, billingRoute.GET, { ext: e1 }, undefined, { "x-partner-key": "ppk_wrong" }));
  keep("responses/error--tenant-not-linked.json", "404: an org Hub doesn't know",
    await call("GET", "/tenants/no-such-org/billing", billingRoute.GET, { ext: "no-such-org" }));
  keep("responses/error--validation.json", "400: bad body (foreign success_url)",
    await call("POST", `/tenants/${e1}/checkout`, checkoutRoute.POST, { ext: e1 }, { success_url: "https://evil.example/x" }));
  keep("responses/error--missing-actor.json", "400: a POST without X-Partner-Actor",
    await call("POST", `/tenants/${e1}/checkout`, checkoutRoute.POST, { ext: e1 }, { success_url: `${ORIGIN}/billing` }, { "x-partner-actor": "" }));

  // ---- webhooks from the real outbox -----------------------------------------
  console.log("webhooks…");
  const rows = await db.query.webhookDeliveries.findMany({
    where: and(eq(webhookDeliveries.partnerAppId, app.id), inArray(webhookDeliveries.subscriptionId,
      (await db.query.subscriptions.findMany({ where: inArray(subscriptions.tenantId, tenants), columns: { id: true } })).map((s) => s.id))),
    orderBy: [asc(webhookDeliveries.createdAt)],
  });
  const seen = new Map<string, number>();
  const ts = 1_792_300_000; // fixed: freeze the receiver's clock to this second in tests
  for (const r of rows) {
    const rawBody = r.kind === "provision" ? JSON.stringify(r.payload) : JSON.stringify({ event: r.event, data: r.payload });
    const signature = "sha256=" + createHmac("sha256", FIXTURE_SECRET).update(`${ts}.${rawBody}`).digest("hex");
    const k = `${r.event}`;
    const i = (seen.get(k) ?? 0) + 1;
    seen.set(k, i);
    keep(`webhooks/${r.event.replace(/\./g, "-")}--${i}.json`, `${r.event} (${r.kind}) as Hub sent it`, {
      headers: {
        "Content-Type": "application/json",
        "X-Plaidware-Event": r.event,
        "X-Plaidware-Delivery": r.deliveryId,
        "X-Plaidware-Timestamp": String(ts),
        "X-Plaidware-Signature": signature,
      },
      rawBody,
      body: JSON.parse(rawBody),
    });
  }
  // These local rows were never deliverable (no webhook URL); drop them so the local outbox stays tidy.
  await db.delete(webhookDeliveries).where(inArray(webhookDeliveries.id, rows.map((r) => r.id)));

  save("manifest.json", {
    generatedAt: new Date().toISOString(),
    hubCommit: process.env.HUB_COMMIT ?? null,
    webhookSecret: FIXTURE_SECRET,
    webhookTimestamp: ts,
    note: "Real Hub responses (local DB, Stripe test mode). Ids, URLs and emails are test data. Webhooks are signed with webhookSecret at webhookTimestamp — freeze the clock to verify.",
    files: manifest,
  });

  await revokePartnerKey(key.id);
  await db.delete(partnerKeys).where(eq(partnerKeys.id, key.id));
  console.log(`\n✅ wrote ${manifest.length} fixtures to ${out}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error("\n❌", e instanceof Error ? e.stack ?? e.message : e);
  await pool.end().catch(() => {});
  process.exit(1);
});
