/**
 * Partner-app outbound-webhook smoke (partner_apps, e.g. Fixorata): emits
 * lifecycle events against a local fake partner and asserts per-app
 * signing, the extended payload (external_tenant_id + billing_status), the
 * provision handshake's link write-back, link conflicts, no membership
 * events, and that MHub rows are left alone while MHub env is unset.
 * Run: node --env-file=.env --import tsx scripts/smoke-partner-webhooks.ts
 * (No dev server needed — the delivery sweep is called directly.)
 */
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";

const SECRET = "smoke-partner-secret-0123456789";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

type Received = { url: string; event: string; body: string; verified: boolean };

async function main() {
  // ---- fake partner ---------------------------------------------------------
  let provisionAnswer: Record<string, unknown> = {};
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const ts = String(req.headers["x-plaidware-timestamp"]);
      const expected = "sha256=" + createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
      const event = String(req.headers["x-plaidware-event"]);
      received.push({ url: req.url ?? "", event, body, verified: req.headers["x-plaidware-signature"] === expected });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(event === "provision.requested" ? provisionAnswer : { status: "processed" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  // MHub unset: its rows must queue but never be attempted. Env must be set
  // before the first src import — src/env.ts snapshots at import.
  delete process.env.MHUB_BASE_URL;
  delete process.env.MHUB_LIFECYCLE_URL;
  delete process.env.MHUB_WEBHOOK_SECRET;

  const { db, pool } = await import("../src/db");
  const { eq, sql } = await import("drizzle-orm");
  const { user, organization, member } = await import("../src/modules/auth/schema");
  const { products } = await import("../src/modules/catalog/schema");
  const { subscriptions } = await import("../src/modules/billing/schema");
  const { webhookDeliveries } = await import("../src/modules/webhooks_out/schema");
  const { partnerApps, partnerTenantLinks } = await import("../src/modules/partners/schema");
  const { encryptSecret } = await import("../src/lib/crypto");
  const { linkPartnerTenant, hubTenantIdFor } = await import("../src/modules/partners/service");
  const { emitSubscriptionLifecycle, runDueDeliveries } = await import("../src/modules/webhooks_out/service");

  const ts = Date.now();
  const deliveriesFor = (subId: string) =>
    db.query.webhookDeliveries.findMany({ where: eq(webhookDeliveries.subscriptionId, subId) });

  // ---- fixtures -------------------------------------------------------------
  const prefix = `smokefix${ts}`;
  const [app] = await db
    .insert(partnerApps)
    .values({
      name: `smoke-${ts}`,
      displayName: "Smoke Partner",
      productPrefixes: [prefix],
      webhookUrl: `http://127.0.0.1:${port}/hooks`,
      webhookSecretEnc: encryptSecret(SECRET),
      allowedReturnOrigins: ["http://127.0.0.1"],
    })
    .returning();
  const [u] = await db
    .insert(user)
    .values({
      id: `pwsmoke_${ts}`,
      name: "Partner Smoke",
      email: `pwsmoke_${ts}@example.com`,
      emailVerified: true,
      firstName: "Partner",
      lastName: "Smoke",
      phone: "555",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  const mkOrg = async (n: number) => {
    const [o] = await db
      .insert(organization)
      .values({ id: crypto.randomUUID(), name: `PW Smoke ${n}`, slug: `pw-smoke-${ts}-${n}`, status: "active", createdAt: new Date() })
      .returning();
    await db.insert(member).values({ id: crypto.randomUUID(), organizationId: o.id, userId: u.id, role: "owner", createdAt: new Date() });
    return o;
  };
  const [orgLinked, orgFresh, orgClash] = [await mkOrg(1), await mkOrg(2), await mkOrg(3)];
  const [product] = await db
    .insert(products)
    .values({ slug: `${prefix}-shop`, name: "Smoke Shop", category: "repair", description: "smoke" })
    .returning();
  const [mhubProduct] = await db
    .insert(products)
    .values({ slug: `marketing-pwsmoke-${ts}`, name: "MHub Smoke", category: "marketing", description: "smoke" })
    .returning();
  const mkSub = async (tenantId: string, productId: string) =>
    (await db.insert(subscriptions).values({ tenantId, productId, status: "active" }).returning())[0];
  const subLinked = await mkSub(orgLinked.id, product.id);
  const subFresh = await mkSub(orgFresh.id, product.id);
  const subClash = await mkSub(orgClash.id, product.id);
  const subMhub = await mkSub(orgLinked.id, mhubProduct.id);

  console.log("1) pre-linked tenant: extended payloads, external id in handshake, no roster");
  const linkRes = await linkPartnerTenant({ partnerAppId: app.id, tenantId: orgLinked.id, externalTenantId: "fx-org-1", linkedBy: "smoke" });
  assert(linkRes.ok && linkRes.changed, "link created");
  assert((await linkPartnerTenant({ partnerAppId: app.id, tenantId: orgLinked.id, externalTenantId: "fx-org-1", linkedBy: "smoke" })).ok, "relink same pair is idempotent");
  const steal = await linkPartnerTenant({ partnerAppId: app.id, tenantId: orgFresh.id, externalTenantId: "fx-org-1", linkedBy: "smoke" });
  assert(!steal.ok && steal.reason === "external_taken", "a taken external id is refused");

  await emitSubscriptionLifecycle(subLinked.id, "subscription.activated");
  const rows = await deliveriesFor(subLinked.id);
  const life = rows.find((r) => r.kind === "lifecycle");
  const prov = rows.find((r) => r.kind === "provision");
  assert(life && life.partnerAppId === app.id, "lifecycle row targets the partner app");
  assert(prov && prov.partnerAppId === app.id, "provision row targets the partner app");
  const lp = life.payload as Record<string, unknown>;
  assert(lp.external_tenant_id === "fx-org-1" && lp.billing_status === "active", "lifecycle payload is extended");
  assert(lp.plan_key === "standard" && lp.cancel_at_period_end === false && "trial_ends_at" in lp, "plan and banner fields present");
  assert(typeof lp.occurred_at === "string" && !Number.isNaN(Date.parse(lp.occurred_at as string)), "occurred_at for ordering");
  assert((prov.payload as Record<string, unknown>).external_tenant_id === "fx-org-1", "handshake names the linked tenant");
  const roster = await db.query.webhookDeliveries.findMany({
    where: sql`${webhookDeliveries.event} = 'membership.changed' and ${webhookDeliveries.payload}->>'hub_org_id' = ${orgLinked.id}`,
  });
  assert(roster.length === 0, "no membership events for an app without receivesMembership");

  console.log("2) MHub rows queue but aren't swept while MHub env is unset");
  await emitSubscriptionLifecycle(subMhub.id, "subscription.activated");
  const mhubRows = await deliveriesFor(subMhub.id);
  assert(mhubRows.length > 0 && mhubRows.every((r) => r.partnerAppId === null), "MHub rows queued with null app");
  const mp = mhubRows.find((r) => r.kind === "lifecycle")!.payload as Record<string, unknown>;
  assert(!("billing_status" in mp) && !("external_tenant_id" in mp), "MHub payload unchanged");

  provisionAnswer = { external_tenant_id: "fx-org-1", portal_url: "https://fixorata.example" };
  const r1 = await runDueDeliveries();
  assert(!("skipped" in r1), "sweep ran for the partner app");
  assert(received.length === 2 && received.every((r) => r.verified), "two signed partner deliveries");
  assert(received.every((r) => r.url === "/hooks"), "provision falls back to webhookUrl");
  assert((await deliveriesFor(subMhub.id)).every((r) => r.status === "pending" && r.attemptCount === 0), "MHub rows untouched");
  assert((await deliveriesFor(subLinked.id)).every((r) => r.status === "delivered"), "partner rows delivered");

  console.log("3) fresh tenant: handshake response creates the link");
  provisionAnswer = { external_tenant_id: "fx-org-2" };
  await emitSubscriptionLifecycle(subFresh.id, "subscription.activated");
  const freshProv = (await deliveriesFor(subFresh.id)).find((r) => r.kind === "provision")!;
  assert(!("external_tenant_id" in (freshProv.payload as object)), "unlinked handshake carries no external id");
  await runDueDeliveries();
  assert((await hubTenantIdFor(app.id, "fx-org-2")) === orgFresh.id, "link written from the handshake response");
  const resend = (await deliveriesFor(subFresh.id)).filter((r) => r.event === "subscription.updated");
  assert(
    resend.length === 1 && (resend[0].payload as Record<string, unknown>).external_tenant_id === "fx-org-2",
    "a new link re-sends the current state carrying external_tenant_id",
  );

  console.log("4) handshake answering an external id linked elsewhere is disabled for ops");
  provisionAnswer = { external_tenant_id: "fx-org-1" };
  await emitSubscriptionLifecycle(subClash.id, "subscription.activated");
  await runDueDeliveries();
  const clash = (await deliveriesFor(subClash.id)).find((r) => r.kind === "provision")!;
  assert(clash.status === "disabled" && /link conflict/.test(clash.lastError ?? ""), `conflict disabled (got ${clash.status}: ${clash.lastError})`);

  console.log("5) a missing external_tenant_id is retried, not accepted");
  await db.delete(webhookDeliveries).where(eq(webhookDeliveries.id, clash.id));
  await db.delete(partnerTenantLinks).where(eq(partnerTenantLinks.tenantId, orgClash.id));
  provisionAnswer = { portal_url: "https://fixorata.example" };
  await emitSubscriptionLifecycle(subClash.id, "subscription.activated");
  await runDueDeliveries();
  const retry = (await deliveriesFor(subClash.id)).find((r) => r.kind === "provision")!;
  assert(retry.status === "pending" && retry.attemptCount === 1, "retry scheduled");

  console.log("6) a disabled app's rows are left alone");
  await db.update(partnerApps).set({ status: "disabled" }).where(eq(partnerApps.id, app.id));
  await db.update(webhookDeliveries).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(webhookDeliveries.id, retry.id));
  const before = received.length;
  const r6 = await runDueDeliveries();
  assert("skipped" in r6 && received.length === before, "nothing attempted");

  console.log("cleanup…");
  for (const o of [orgLinked, orgFresh, orgClash]) {
    await db.delete(webhookDeliveries).where(sql`${webhookDeliveries.payload}->>'hub_org_id' = ${o.id}`);
    await db.delete(organization).where(eq(organization.id, o.id));
  }
  await db.delete(partnerApps).where(eq(partnerApps.id, app.id));
  await db.delete(products).where(eq(products.id, product.id));
  await db.delete(products).where(eq(products.id, mhubProduct.id));
  await db.delete(user).where(eq(user.id, u.id));

  server.close();
  console.log("\n✅ PARTNER WEBHOOKS SMOKE: ALL PASSED");
  await pool.end();
}

main().catch(async (e) => {
  console.error("\n❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
