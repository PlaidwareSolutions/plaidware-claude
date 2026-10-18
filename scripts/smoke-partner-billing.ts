/**
 * Partner API v1 smoke (Stripe TEST MODE, local DB, no dev server — the
 * route handlers are called in-process). Covers key/actor/idempotency
 * guards, POST /tenants → pay link → payment (the pay page's exact Stripe
 * path) → active, the BillingSummary, add-on quantities up/down/off, the
 * portal session, period-end cancel + resume, workspace lock, invoice
 * scoping, the audit actor, and the trial flow (no card to start, "add a
 * card" link during the trial, no second trial on reactivation) plus the
 * partner billing page in Hub's emails.
 * Run: node --env-file=.env --import tsx scripts/smoke-partner-billing.ts
 */
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { getStripe } from "../src/lib/stripe";
import { organization, user } from "../src/modules/auth/schema";
import { auditLogs } from "../src/modules/audit/schema";
import { productComponents, products } from "../src/modules/catalog/schema";
import { subscriptions } from "../src/modules/billing/schema";
import { applyInvoiceEvent, applySubscriptionEvent } from "../src/modules/billing/service";
import { partnerApps, partnerKeys } from "../src/modules/partners/schema";
import { billingPageUrlFor, mintPartnerKey } from "../src/modules/partners/service";
import { completePayLink, getPayPage } from "../src/modules/partners/api-service";
import * as tenantsRoute from "../src/app/api/partners/v1/tenants/route";
import * as billingRoute from "../src/app/api/partners/v1/tenants/[ext]/billing/route";
import * as invoicesRoute from "../src/app/api/partners/v1/tenants/[ext]/invoices/route";
import * as checkoutRoute from "../src/app/api/partners/v1/tenants/[ext]/checkout/route";
import * as portalRoute from "../src/app/api/partners/v1/tenants/[ext]/portal-session/route";
import * as itemsRoute from "../src/app/api/partners/v1/tenants/[ext]/subscriptions/[sid]/items/route";
import * as cancelRoute from "../src/app/api/partners/v1/tenants/[ext]/subscriptions/[sid]/cancel/route";
import * as tenantRoute from "../src/app/api/partners/v1/tenants/[ext]/route";
import * as resumeRoute from "../src/app/api/partners/v1/tenants/[ext]/subscriptions/[sid]/resume/route";

const stripe = getStripe();
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const BASE = "http://hub.test/api/partners/v1";
const ORIGIN = "https://shop.example";
const ACTOR = JSON.stringify({ external_user_id: "fx-user-1", email: "owner@shop.example", name: "Shop Owner", role: "owner" });

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function main() {
  const ts = Date.now();
  const prefix = `smokefx${ts}`;
  const ext = `fx-org-${ts}`;

  // ---- fixtures -------------------------------------------------------------
  const [app] = await db
    .insert(partnerApps)
    .values({ name: `smokefx-${ts}`, displayName: "Smoke Fix", productPrefixes: [prefix], allowedReturnOrigins: [ORIGIN], billingUrl: `${ORIGIN}/billing` })
    .returning();
  const good = await mintPartnerKey(`smokefx-${ts}`, [prefix]);
  await db.update(partnerKeys).set({ partnerAppId: app.id }).where(eq(partnerKeys.id, good.id));
  const appless = await mintPartnerKey(`smokefx-appless-${ts}`, [prefix]);

  const [product] = await db
    .insert(products)
    .values({ slug: `${prefix}-shop`, name: "Smoke Fix Shop", category: "repair", description: "smoke" })
    .returning();
  await db.insert(productComponents).values([
    { productId: product.id, kind: "one_time", name: "Onboarding", amountCents: 15000, isRequired: true },
    { productId: product.id, kind: "recurring", interval: "month", role: "base", name: "Subscription", amountCents: 14900, isRequired: true },
  ]);
  const [terminal] = await db
    .insert(productComponents)
    .values({ productId: product.id, kind: "recurring", interval: "month", name: "Extra Terminal", amountCents: 3900 })
    .returning();
  const [trialProduct] = await db
    .insert(products)
    .values({ slug: `${prefix}-trial`, name: "Smoke Fix Trial", category: "repair", description: "smoke", trialDays: 30 })
    .returning();
  await db.insert(productComponents).values({
    productId: trialProduct.id, kind: "recurring", interval: "month", role: "base", name: "Subscription", amountCents: 3500, isRequired: true,
  });
  const [otherProduct] = await db
    .insert(products)
    .values({ slug: `notfx-${ts}`, name: "Other Product", category: "web", description: "smoke" })
    .returning();

  // ---- request helpers ------------------------------------------------------
  let keyN = 0;
  const req = (method: string, path: string, body?: unknown, h: Record<string, string | null> = {}) => {
    const headers = new Headers({ "content-type": "application/json" });
    const defaults: Record<string, string | null> = {
      "x-partner-key": good.raw,
      ...(method === "POST" ? { "x-partner-actor": ACTOR, "idempotency-key": `k-${ts}-${++keyN}` } : {}),
      ...h,
    };
    for (const [k, v] of Object.entries(defaults)) if (v != null) headers.set(k, v);
    return new NextRequest(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) }) as never;
  const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Json });
  const startBody = {
    external_tenant_id: ext,
    name: `Smoke Fix Repairs ${ts}`,
    owner: { email: `pfx_${ts}@example.com`, name: "Pat Owner" },
    product_slug: product.slug,
    success_url: `${ORIGIN}/billing?paid=1`,
    cancel_url: `${ORIGIN}/billing`,
  };
  const billing = async () => json(await billingRoute.GET(req("GET", `/tenants/${ext}/billing`), ctx({ ext })));

  console.log("1) auth, actor, idempotency and redirect guards");
  let r = await json(await tenantsRoute.POST(req("POST", "/tenants", startBody, { "x-partner-key": null })));
  assert(r.status === 401 && r.body.error.code === "unauthorized", "missing key → 401");
  r = await json(await tenantsRoute.POST(req("POST", "/tenants", startBody, { "x-partner-key": appless.raw })));
  assert(r.status === 401, "key without an app → 401");
  r = await json(await tenantsRoute.POST(req("POST", "/tenants", startBody, { "x-partner-actor": null })));
  assert(r.status === 400 && /X-Partner-Actor/.test(r.body.error.message), "missing actor → 400");
  r = await json(await tenantsRoute.POST(req("POST", "/tenants", startBody, { "idempotency-key": null })));
  assert(r.status === 400 && /Idempotency-Key/.test(r.body.error.message), "missing idempotency key → 400");
  r = await json(await tenantsRoute.POST(req("POST", "/tenants", { ...startBody, success_url: "https://evil.example/x" })));
  assert(r.status === 400 && r.body.error.code === "validation_failed", "foreign success_url → 400");
  r = await json(await tenantsRoute.POST(req("POST", "/tenants", { ...startBody, product_slug: otherProduct.slug })));
  assert(r.status === 403 && r.body.error.code === "forbidden_scope", "another app's product → 403");
  r = await billing().then((x) => x);
  assert(r.status === 404 && r.body.error.code === "tenant_not_linked", "unknown tenant → 404");

  console.log("2) POST /tenants creates the workspace, link and pay link; replays are stable");
  const startReq = () => req("POST", "/tenants", startBody, { "idempotency-key": `start-${ts}` });
  const started = await json(await tenantsRoute.POST(startReq()));
  assert(started.status === 201, `start → 201 (got ${started.status} ${JSON.stringify(started.body)})`);
  assert(started.body.billing_status === "pending" && /\/pay\//.test(started.body.payment_url), "pending + pay link");
  const replay = await json(await tenantsRoute.POST(startReq()));
  assert(replay.status === 201 && replay.body.payment_url === started.body.payment_url, "same key replays the stored response");
  r = await json(await tenantsRoute.POST(req("POST", "/tenants", { ...startBody, name: "Different" }, { "idempotency-key": `start-${ts}` })));
  assert(r.status === 409 && r.body.error.code === "idempotency_conflict", "same key, different body → 409");
  const again = await json(await tenantsRoute.POST(req("POST", "/tenants", startBody)));
  assert(again.body.hub_org_id === started.body.hub_org_id && again.body.payment_url !== started.body.payment_url, "new key: same tenant, fresh link");
  const tenantId: string = started.body.hub_org_id;
  const hubOwner = await db.query.user.findFirst({ where: eq(user.email, startBody.owner.email) });
  assert(hubOwner && !hubOwner.emailVerified, "owner account created without a password/verification email");

  let b = (await billing()).body;
  assert(b.billing_status === "pending" && b.subscription?.status === "incomplete", "summary: pending/incomplete");
  assert(b.subscription.items.length === 2, "base + onboarding items");
  const opt = b.subscription.addon_options.find((o: Json) => o.component_id === terminal.id);
  assert(opt && opt.current_quantity === 0 && opt.unit_amount_cents === 3900, "Extra Terminal offered at 0");

  console.log("3) pay page → Stripe payment → active");
  const token = String(started.body.payment_url).split("/pay/")[1];
  const page = await getPayPage(token);
  assert(page.state === "pay" && page.mode === "payment", `pay page ready (got ${page.state})`);
  assert(page.amountDueCents === 15000 + 14900, `due now ${page.amountDueCents}`);
  await stripe.paymentIntents.confirm(page.clientSecret.split("_secret_")[0], { payment_method: "pm_card_visa" });
  const sub = (await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, b.subscription.hub_subscription_id) }))!;
  const ss = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId!, { expand: ["latest_invoice"] });
  await applyInvoiceEvent(ss.latest_invoice as never, "invoice.paid");
  await applySubscriptionEvent(await stripe.subscriptions.retrieve(sub.stripeSubscriptionId!));
  assert((await completePayLink(token)) === startBody.success_url, "done → success_url");
  assert((await getPayPage(token)).state === "done", "used link reads done");
  b = (await billing()).body;
  assert(b.billing_status === "active", `active after payment (got ${b.billing_status})`);
  assert(b.subscription.plan_key === "standard", "list price → plan_key standard");
  assert(b.payment_method?.last4 === "4242", "card on file shown");
  assert(b.invoices.some((i: Json) => i.status === "paid"), "paid invoice listed");
  const noLink = await json(await checkoutRoute.POST(req("POST", `/tenants/${ext}/checkout`, { success_url: `${ORIGIN}/billing`, product_slug: product.slug }), ctx({ ext })));
  assert(noLink.status === 200 && noLink.body.payment_url === null, "checkout on a paid sub → no pay link");

  console.log("4) add-on quantities: 0 → 2 → 1 → 0");
  const sid: string = b.subscription.hub_subscription_id;
  const setTerm = async (quantity: number) =>
    json(await itemsRoute.POST(req("POST", `/tenants/${ext}/subscriptions/${sid}/items`, { changes: [{ component_id: terminal.id, quantity }] }), ctx({ ext, sid })));
  const qty = (s: Json) => s.subscription.addon_options.find((o: Json) => o.component_id === terminal.id).current_quantity;
  r = await setTerm(2);
  assert(r.status === 200 && qty(r.body) === 2, `quantity 2 (got ${r.status} ${JSON.stringify(r.body.error ?? "")})`);
  r = await setTerm(1);
  assert(qty(r.body) === 1, "quantity lowered to 1");
  r = await setTerm(0);
  assert(qty(r.body) === 0, "removed");
  const base = b.subscription.items.find((i: Json) => i.role === "base");
  r = await json(await itemsRoute.POST(req("POST", `/tenants/${ext}/subscriptions/${sid}/items`, { changes: [{ component_id: base.component_id, quantity: 2 }] }), ctx({ ext, sid })));
  assert(r.status === 400, "base charge refused");
  r = await json(await itemsRoute.POST(req("POST", `/tenants/${ext}/subscriptions/not-a-uuid/items`, { changes: [{ component_id: terminal.id, quantity: 1 }] }), ctx({ ext, sid: "not-a-uuid" })));
  assert(r.status === 404, "bad subscription id → 404");
  const [foreign] = await db.insert(subscriptions).values({ tenantId, productId: otherProduct.id, status: "active" }).returning();
  r = await json(await itemsRoute.POST(req("POST", `/tenants/${ext}/subscriptions/${foreign.id}/items`, { changes: [{ component_id: terminal.id, quantity: 1 }] }), ctx({ ext, sid: foreign.id })));
  assert(r.status === 403 && r.body.error.code === "forbidden_scope", "another product's subscription → 403");

  console.log("5) portal session");
  r = await json(await portalRoute.POST(req("POST", `/tenants/${ext}/portal-session`, { return_url: "https://evil.example" }), ctx({ ext })));
  assert(r.status === 400, "foreign return_url → 400");
  r = await json(await portalRoute.POST(req("POST", `/tenants/${ext}/portal-session`, { return_url: `${ORIGIN}/billing` }), ctx({ ext })));
  assert(r.status === 200 && String(r.body.url).startsWith("https://billing.stripe.com/"), "portal URL minted");

  console.log("6) cancel at period end, then resume");
  r = await json(await cancelRoute.POST(req("POST", `/tenants/${ext}/subscriptions/${sid}/cancel`, { at_period_end: true, reason: "smoke" }), ctx({ ext, sid })));
  assert(r.status === 200 && r.body.subscription.cancel_at_period_end === true && r.body.billing_status === "active", "scheduled, still active");
  assert((await stripe.subscriptions.retrieve(sub.stripeSubscriptionId!)).cancel_at_period_end, "Stripe agrees");
  r = await json(await resumeRoute.POST(req("POST", `/tenants/${ext}/subscriptions/${sid}/resume`, {}), ctx({ ext, sid })));
  assert(r.status === 200 && r.body.subscription.cancel_at_period_end === false, "resumed");

  console.log("7) suspended workspace refuses changes; invoices stay scoped");
  await db.update(organization).set({ status: "suspended" }).where(eq(organization.id, tenantId));
  r = await setTerm(1);
  assert(r.status === 409 && r.body.error.code === "workspace_locked", "suspended → workspace_locked");
  assert((await billing()).body.billing_status === "suspended", "a Hub workspace hold reads as billing_status suspended");
  await db.update(organization).set({ status: "active" }).where(eq(organization.id, tenantId));
  const inv = await json(await invoicesRoute.GET(req("GET", `/tenants/${ext}/invoices?limit=1`), ctx({ ext })));
  assert(inv.status === 200 && inv.body.invoices.length === 1, "invoice page of 1");

  console.log("8) audit trail names the partner actor");
  const audit = await db.query.auditLogs.findMany({ where: eq(auditLogs.tenantId, tenantId) });
  const kinds = new Set(audit.map((a) => a.kind));
  for (const k of ["partner_tenant_created", "partner_link_set", "partner_checkout_started", "subscription_items_changed", "subscription_cancel_scheduled", "subscription_cancel_unscheduled"]) {
    assert(kinds.has(k), `audit ${k}`);
  }
  assert(
    audit.filter((a) => a.kind === "subscription_items_changed").every((a) => (a.payload as Json).via === `partner:${app.name}/owner@shop.example`),
    "items audit carries the actor",
  );

  console.log("9) trial: no card to start, add one during the trial, no second trial");
  const ext2 = `fx-trial-${ts}`;
  const tStart = await json(
    await tenantsRoute.POST(req("POST", "/tenants", { ...startBody, external_tenant_id: ext2, name: `Trial Shop ${ts}`, product_slug: trialProduct.slug })),
  );
  assert(tStart.status === 201 && tStart.body.billing_status === "trialing" && tStart.body.payment_url === null, `trial starts with no card (got ${JSON.stringify(tStart.body)})`);
  const tenant2: string = tStart.body.hub_org_id;
  assert(
    (await billingPageUrlFor(tenant2, "https://hub/billing")) === `${ORIGIN}/billing?org=${ext2}`,
    "Hub emails link to the partner's billing page for that shop",
  );
  assert((await billingPageUrlFor(tenantId, "https://hub/billing")) === "https://hub/billing", "a client with other live Hub products keeps Hub's billing page");
  const replayTrial = await json(
    await tenantsRoute.POST(req("POST", "/tenants", { ...startBody, external_tenant_id: ext2, name: `Trial Shop ${ts}`, product_slug: trialProduct.slug })),
  );
  assert(replayTrial.body.payment_url === null && replayTrial.body.hub_org_id === tenant2, "re-start during the trial still asks for no card");
  const addCard = await json(
    await checkoutRoute.POST(req("POST", `/tenants/${ext2}/checkout`, { success_url: `${ORIGIN}/billing`, product_slug: trialProduct.slug }), ctx({ ext: ext2 })),
  );
  assert(/\/pay\//.test(addCard.body.payment_url), "checkout during the trial → add-a-card link");
  const t2 = String(addCard.body.payment_url).split("/pay/")[1];
  const setupPage = await getPayPage(t2);
  assert(setupPage.state === "pay" && setupPage.mode === "setup" && setupPage.amountDueCents === 0, "pay page saves a card, charges nothing");
  await stripe.setupIntents.confirm(setupPage.clientSecret.split("_secret_")[0], { payment_method: "pm_card_visa" });
  const sub2 = (await db.query.subscriptions.findFirst({ where: eq(subscriptions.tenantId, tenant2) }))!;
  for (let i = 0; i < 15; i++) {
    if ((await stripe.subscriptions.retrieve(sub2.stripeSubscriptionId!)).default_payment_method) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert((await completePayLink(t2)) === `${ORIGIN}/billing`, "back to the partner");
  let b2 = (await json(await billingRoute.GET(req("GET", `/tenants/${ext2}/billing`), ctx({ ext: ext2 })))).body;
  assert(b2.billing_status === "trialing" && b2.payment_method?.last4 === "4242", `card on file during the trial (got ${JSON.stringify(b2.payment_method)})`);
  assert(b2.subscription.addon_options.length === 0 && b2.subscription.items.length === 1, "just the $35 plan");
  const noMore = await json(
    await checkoutRoute.POST(req("POST", `/tenants/${ext2}/checkout`, { success_url: `${ORIGIN}/billing`, product_slug: trialProduct.slug }), ctx({ ext: ext2 })),
  );
  assert(noMore.body.payment_url === null, "card saved → nothing left to do");
  r = await json(
    await cancelRoute.POST(req("POST", `/tenants/${ext2}/subscriptions/${sub2.id}/cancel`, { at_period_end: false }), ctx({ ext: ext2, sid: sub2.id })),
  );
  assert(r.status === 200 && r.body.billing_status === "canceled", "cancel now → canceled");
  const react = await json(
    await checkoutRoute.POST(req("POST", `/tenants/${ext2}/checkout`, { success_url: `${ORIGIN}/billing`, product_slug: trialProduct.slug }), ctx({ ext: ext2 })),
  );
  assert(react.body.billing_status === "pending" && /\/pay\//.test(react.body.payment_url), `reactivation is paid, no second trial (got ${JSON.stringify(react.body)})`);
  const reactPage = await getPayPage(String(react.body.payment_url).split("/pay/")[1]);
  assert(reactPage.state === "pay" && reactPage.mode === "payment" && reactPage.amountDueCents === 3500, "reactivation charges $35 now");
  b2 = (await json(await billingRoute.GET(req("GET", `/tenants/${ext2}/billing`), ctx({ ext: ext2 })))).body;
  const sub3 = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, b2.subscription.hub_subscription_id) });

  console.log("10) PATCH /tenants/:ext keeps name and billing contact current");
  const { billingContactOverride } = await import("../src/modules/partners/service");
  const patchReq = (body: unknown) =>
    new NextRequest(`${BASE}/tenants/${ext}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-partner-key": good.raw, "x-partner-actor": ACTOR, "idempotency-key": `patch-${ts}-${++keyN}` },
      body: JSON.stringify(body),
    });
  r = await json(await tenantRoute.PATCH(patchReq({}), ctx({ ext })));
  assert(r.status === 400, "empty patch → 400");
  r = await json(await tenantRoute.PATCH(patchReq({ name: "Renamed Repairs", billing_email: "Books@Shop.Example" }), ctx({ ext })));
  assert(r.status === 200, `patch ok (got ${r.status} ${JSON.stringify(r.body)})`);
  assert((await db.query.organization.findFirst({ where: eq(organization.id, tenantId) }))?.name === "Renamed Repairs", "workspace renamed");
  assert((await billingContactOverride(tenantId)) === "books@shop.example", "billing emails now go to the partner's contact");
  const cust = await db.query.organization.findFirst({ where: eq(organization.id, tenantId) });
  const sc = (await stripe.customers.retrieve(cust!.stripeCustomerId!)) as { email?: string | null; name?: string | null };
  assert(sc.email === "books@shop.example" && sc.name === "Renamed Repairs", "Stripe customer updated");

  console.log("cleanup…");
  await stripe.subscriptions.cancel(sub.stripeSubscriptionId!).catch(() => {});
  if (sub3?.stripeSubscriptionId) await stripe.subscriptions.cancel(sub3.stripeSubscriptionId).catch(() => {});
  await db.delete(organization).where(eq(organization.id, tenantId));
  await db.delete(organization).where(eq(organization.id, tenant2));
  await db.delete(products).where(eq(products.id, trialProduct.id));
  await db.delete(partnerKeys).where(eq(partnerKeys.id, appless.id));
  await db.delete(partnerKeys).where(and(eq(partnerKeys.id, good.id)));
  await db.delete(partnerApps).where(eq(partnerApps.id, app.id));
  await db.delete(products).where(eq(products.id, product.id));
  await db.delete(products).where(eq(products.id, otherProduct.id));
  await db.delete(user).where(eq(user.id, hubOwner.id));

  console.log("\n✅ PARTNER BILLING SMOKE: ALL PASSED");
  await pool.end();
}

main().catch(async (e) => {
  console.error("\n❌", e instanceof Error ? e.stack ?? e.message : e);
  await pool.end().catch(() => {});
  process.exit(1);
});
