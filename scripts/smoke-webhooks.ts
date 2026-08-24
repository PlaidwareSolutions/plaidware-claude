/**
 * MHub outbound-webhook smoke: emits real lifecycle events against a local
 * fake-MHub listener and asserts signatures, the provision handshake,
 * retries, dead-lettering, requeue, and the 410 disable path.
 * Run: node --env-file=.env --import tsx scripts/smoke-webhooks.ts
 * (No dev server needed — the delivery sweep is called directly.)
 */
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";

const SECRET = "smoke-webhook-secret-0123456789";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

type Received = {
  url: string;
  event: string;
  delivery: string;
  body: string;
  verified: boolean;
};

async function main() {
  // ---- fake MHub -----------------------------------------------------------
  let mode: "ok" | "fail" | "gone" = "ok";
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const ts = String(req.headers["x-plaidware-timestamp"]);
      const expected =
        "sha256=" + createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
      received.push({
        url: req.url ?? "",
        event: String(req.headers["x-plaidware-event"]),
        delivery: String(req.headers["x-plaidware-delivery"]),
        body,
        verified: req.headers["x-plaidware-signature"] === expected,
      });
      if (mode === "fail") return void (res.writeHead(500), res.end("boom"));
      if (mode === "gone") return void (res.writeHead(410), res.end());
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        req.url === "/api/hub/provision"
          ? JSON.stringify({
              tenant_slug: "smoke-tenant",
              portal_url: portalUrl,
              events_api_key_prefix: "mhk_test",
            })
          : "{}",
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const portalUrl = `http://127.0.0.1:${port}/portal/smoke-tenant`;

  // Env must be set before the first src import — src/env.ts snapshots at import.
  process.env.MHUB_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.MHUB_LIFECYCLE_URL = `http://127.0.0.1:${port}/api/hub/lifecycle`;
  process.env.MHUB_WEBHOOK_SECRET = SECRET;

  const { db, pool } = await import("../src/db");
  const { and, eq, sql } = await import("drizzle-orm");
  const { user, organization, member } = await import("../src/modules/auth/schema");
  const { products, productComponents } = await import("../src/modules/catalog/schema");
  const { subscriptions, subscriptionItems } = await import("../src/modules/billing/schema");
  const { webhookDeliveries } = await import("../src/modules/webhooks_out/schema");
  const { subscriptionProvisioning } = await import("../src/modules/provisioning/schema");
  const { emitSubscriptionLifecycle, runDueDeliveries, requeueDelivery } = await import(
    "../src/modules/webhooks_out/service"
  );

  const ts = Date.now();
  const rewind = (id: string) =>
    db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(webhookDeliveries.id, id));

  // ---- fixtures ------------------------------------------------------------
  const [u] = await db
    .insert(user)
    .values({
      id: `whsmoke_${ts}`,
      name: "Webhook Smoke",
      email: `whsmoke_${ts}@example.com`,
      emailVerified: true,
      firstName: "Webhook",
      lastName: "Smoke",
      phone: "555",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  const [org] = await db
    .insert(organization)
    .values({ id: crypto.randomUUID(), name: "WH Smoke Org", slug: `wh-smoke-${ts}`, status: "active", createdAt: new Date() })
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
    .values({
      slug: `marketing-smoke-${ts}`,
      name: "Marketing Smoke",
      category: "marketing",
      description: "smoke",
    })
    .returning();
  const [baseComp] = await db
    .insert(productComponents)
    .values({ productId: product.id, kind: "recurring", interval: "month", role: "base", name: "Plan", amountCents: 1000 })
    .returning();
  const [addonComp] = await db
    .insert(productComponents)
    .values({ productId: product.id, kind: "recurring", interval: "month", name: "Extra location", amountCents: 500 })
    .returning();
  const [sub] = await db
    .insert(subscriptions)
    .values({ tenantId: org.id, productId: product.id, status: "active" })
    .returning();
  await db.insert(subscriptionItems).values([
    { subscriptionId: sub.id, componentId: baseComp.id, kind: "recurring", interval: "month", name: "Plan", amountCents: 1000, status: "active" },
    { subscriptionId: sub.id, componentId: addonComp.id, kind: "recurring", interval: "month", name: "Extra location", amountCents: 500, status: "active" },
  ]);
  const deliveriesFor = (subId: string) =>
    db.query.webhookDeliveries.findMany({ where: eq(webhookDeliveries.subscriptionId, subId) });

  console.log("1) activation emit → lifecycle + provision + roster rows queued");
  await emitSubscriptionLifecycle(sub.id, "subscription.activated");
  let rows = await deliveriesFor(sub.id);
  const lifecycleRow = rows.find((r) => r.kind === "lifecycle");
  const provisionRow = rows.find((r) => r.kind === "provision");
  assert(lifecycleRow && lifecycleRow.event === "subscription.activated", "activation row queued");
  assert(provisionRow, "provision handshake row queued");
  const payload = lifecycleRow.payload as Record<string, unknown>;
  assert(payload.hub_subscription_id === sub.id, "payload subscription id");
  assert(payload.hub_org_id === org.id, "payload org id");
  assert(payload.status === "active", "payload status");
  const addons = payload.addon_components as { name: string; quantity: number }[];
  assert(
    addons.length === 1 && addons[0].name === "Extra location" && addons[0].quantity === 1,
    "addon_components excludes the base and counts the addon",
  );
  const roster = await db.query.webhookDeliveries.findMany({
    where: and(
      eq(webhookDeliveries.event, "membership.changed"),
      sql`${webhookDeliveries.payload}->>'hub_org_id' = ${org.id}`,
    ),
  });
  assert(roster.length === 1 && (roster[0].payload as Record<string, unknown>).role === "owner", "owner roster replay queued");

  console.log("2) marketing-* filter: non-marketing sub emits nothing");
  const [webProduct] = await db
    .insert(products)
    .values({ slug: `smokeweb-${ts}`, name: "Web Smoke", category: "web", description: "smoke" })
    .returning();
  const [webSub] = await db
    .insert(subscriptions)
    .values({ tenantId: org.id, productId: webProduct.id, status: "active" })
    .returning();
  await emitSubscriptionLifecycle(webSub.id, "subscription.activated");
  assert((await deliveriesFor(webSub.id)).length === 0, "no deliveries for non-marketing product");

  console.log("3) sweep delivers, signatures verify, portal_url persisted");
  let result = await runDueDeliveries();
  assert(!("skipped" in result), "sweep ran (env configured)");
  assert(result.delivered >= 3, `everything delivered (got ${JSON.stringify(result)})`);
  assert(received.length >= 3 && received.every((r) => r.verified), "every request signature verified");
  const provisionReq = received.find((r) => r.url === "/api/hub/provision");
  assert(provisionReq, "provision handshake hit /api/hub/provision");
  const provisionBody = JSON.parse(provisionReq.body);
  assert(provisionBody.owner_email === u.email && provisionBody.org_slug === org.slug, "provision body carries org+owner");
  assert(!("event" in provisionBody), "provision body is flat (§C), not {event,data}");
  const lifecycleReq = received.find((r) => r.url === "/api/hub/lifecycle");
  assert(lifecycleReq && JSON.parse(lifecycleReq.body).event === "subscription.activated", "lifecycle body is {event,data}");
  const prov = await db.query.subscriptionProvisioning.findFirst({
    where: eq(subscriptionProvisioning.subscriptionId, sub.id),
  });
  assert(prov?.domainUrl === portalUrl, "portal_url persisted to provisioning row");
  assert(prov?.dnsLastOk == null && prov?.verifyToken == null, "DNS fields stay null for marketing-*");

  console.log("4) failures back off 1m→…→dead-letter after 6 attempts");
  mode = "fail";
  await emitSubscriptionLifecycle(sub.id, "subscription.updated");
  rows = await deliveriesFor(sub.id);
  const failing = rows.find((r) => r.event === "subscription.updated");
  assert(failing, "updated row queued");
  result = await runDueDeliveries();
  let row = (await deliveriesFor(sub.id)).find((r) => r.id === failing.id)!;
  assert(row.status === "pending" && row.attemptCount === 1, "first failure stays pending");
  assert(row.lastError === "HTTP 500", "lastError recorded");
  const delayMs = row.nextAttemptAt.getTime() - Date.now();
  assert(delayMs > 50_000 && delayMs < 70_000, `first retry ~60s out (got ${Math.round(delayMs / 1000)}s)`);
  for (let i = 0; i < 5; i++) {
    await rewind(failing.id);
    await runDueDeliveries();
  }
  row = (await deliveriesFor(sub.id)).find((r) => r.id === failing.id)!;
  assert(row.status === "dead" && row.attemptCount === 6, `dead after 6 attempts (got ${row.status}/${row.attemptCount})`);
  assert(row.deliveryId === failing.deliveryId, "delivery uuid stable across retries");

  console.log("5) requeue resets the budget; 410 disables permanently");
  await requeueDelivery(failing.id);
  row = (await deliveriesFor(sub.id)).find((r) => r.id === failing.id)!;
  assert(row.status === "pending" && row.attemptCount === 0, "requeue resets attempts");
  mode = "gone";
  await runDueDeliveries();
  row = (await deliveriesFor(sub.id)).find((r) => r.id === failing.id)!;
  assert(row.status === "disabled", "410 → disabled");

  console.log("cleanup…");
  await db
    .delete(webhookDeliveries)
    .where(sql`${webhookDeliveries.payload}->>'hub_org_id' = ${org.id}`);
  await db.delete(organization).where(eq(organization.id, org.id)); // cascades subs → deliveries/provisioning
  await db.delete(products).where(eq(products.id, product.id));
  await db.delete(products).where(eq(products.id, webProduct.id));
  await db.delete(user).where(eq(user.id, u.id));

  server.close();
  console.log("\n✅ WEBHOOKS SMOKE: ALL PASSED");
  await pool.end();
}

main().catch(async (e) => {
  console.error("\n❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
