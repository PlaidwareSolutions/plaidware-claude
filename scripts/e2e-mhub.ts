/**
 * Full E2E against a LIVE MHub (Phase 2+ receivers): drives the real outbox
 * pipeline (emit → sweep → deliver) plus wire-level idempotency checks that
 * need MHub's response bodies. Uses the seeded marketing-hs-growth product
 * and a throwaway org; MHub keeps its mirrored tenant afterwards (churned).
 *
 * Run against staging via the Postgres wrapper:
 *   railway run --service Postgres -- sh -c 'DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$RAILWAY_TCP_PROXY_DOMAIN:$RAILWAY_TCP_PROXY_PORT/$PGDATABASE" \
 *     BETTER_AUTH_SECRET=<32+ char placeholder> APP_BASE_URL=<hub staging url> \
 *     MHUB_BASE_URL=… MHUB_LIFECYCLE_URL=… MHUB_WEBHOOK_SECRET=… \
 *     [PARTNER_KEY=ppk_…] node --import tsx scripts/e2e-mhub.ts'
 *
 * The staging worker sweeps concurrently — that's fine (MHub dedupes by
 * delivery uuid); assertions poll row state instead of assuming who delivered.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { env } from "../src/env";
import { user, organization, member } from "../src/modules/auth/schema";
import { products, productComponents } from "../src/modules/catalog/schema";
import { subscriptions, subscriptionItems } from "../src/modules/billing/schema";
import { webhookDeliveries } from "../src/modules/webhooks_out/schema";
import { subscriptionProvisioning } from "../src/modules/provisioning/schema";
import {
  emitSubscriptionLifecycle,
  emitMembershipChanged,
  runDueDeliveries,
  requeueDelivery,
} from "../src/modules/webhooks_out/service";
import { buildDeliveryHeaders, signWebhookPayload } from "../src/modules/webhooks_out/logic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function signedPost(url: string, event: string, deliveryId: string, body: unknown) {
  const raw = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const res = await fetch(url, {
    method: "POST",
    headers: buildDeliveryHeaders({
      event,
      deliveryId,
      timestampSeconds: t,
      signature: signWebhookPayload(env.MHUB_WEBHOOK_SECRET!, t, raw),
    }),
    body: raw,
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

/** Sweep, then poll until every id is delivered (the staging worker may race us — either winner is fine). */
async function deliverAndExpect(ids: string[], label: string) {
  for (let i = 0; i < 20; i++) {
    const r = await runDueDeliveries();
    assert(!("skipped" in r), "MHUB env not configured");
    const rows = await db.query.webhookDeliveries.findMany({
      where: inArray(webhookDeliveries.id, ids),
    });
    if (rows.length === ids.length && rows.every((x) => x.status === "delivered")) return rows;
    const bad = rows.find((x) => x.status === "dead" || x.status === "disabled");
    assert(!bad, `${label}: delivery ${bad?.id} ${bad?.status}: ${bad?.lastError}`);
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`ASSERT FAILED: ${label}: not delivered within 20s`);
}

async function main() {
  assert(env.MHUB_BASE_URL && env.MHUB_LIFECYCLE_URL && env.MHUB_WEBHOOK_SECRET, "MHUB_* env required");
  const ts = Date.now();

  console.log("0) requeue any 501-era dead letters (re-signed automatically per attempt)");
  const stale = await db.query.webhookDeliveries.findMany({
    where: inArray(webhookDeliveries.status, ["dead", "disabled"]),
  });
  for (const d of stale) await requeueDelivery(d.id);
  console.log(`   ${stale.length} requeued`);

  // ---- fixtures: real seeded product, throwaway org with 2 members --------
  const product = await db.query.products.findFirst({
    where: eq(products.slug, "marketing-hs-growth"),
  });
  assert(product, "marketing-hs-growth must be seeded first");
  const comps = await db.query.productComponents.findMany({
    where: eq(productComponents.productId, product.id),
  });
  const base = comps.find((c) => c.role === "base");
  const extra = comps.find((c) => c.name === "Extra location");
  assert(base && extra, "seeded components present");

  const mkUser = async (tag: string) =>
    (
      await db
        .insert(user)
        .values({
          id: `e2e_${tag}_${ts}`,
          name: `E2E ${tag}`,
          email: `e2e_${tag}_${ts}@plaidware.com`,
          emailVerified: true,
          firstName: "E2E",
          lastName: tag,
          phone: "555",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()
    )[0];
  const owner = await mkUser("owner");
  const teammate = await mkUser("member");
  const [org] = await db
    .insert(organization)
    .values({ id: crypto.randomUUID(), name: `E2E Org ${ts}`, slug: `e2e-${ts}`, status: "active", createdAt: new Date() })
    .returning();
  await db.insert(member).values([
    { id: crypto.randomUUID(), organizationId: org.id, userId: owner.id, role: "owner", createdAt: new Date() },
    { id: crypto.randomUUID(), organizationId: org.id, userId: teammate.id, role: "member", createdAt: new Date() },
  ]);
  const [sub] = await db
    .insert(subscriptions)
    .values({ tenantId: org.id, productId: product.id, status: "incomplete", currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) })
    .returning();
  // Two "Extra location" rows = quantity 2 in the aggregated payload (HUB-4).
  await db.insert(subscriptionItems).values([
    { subscriptionId: sub.id, componentId: base.id, kind: "recurring", interval: "month", name: base.name, amountCents: base.amountCents, status: "active" },
    { subscriptionId: sub.id, componentId: extra.id, kind: "recurring", interval: "month", name: extra.name, amountCents: extra.amountCents, status: "active" },
    { subscriptionId: sub.id, componentId: extra.id, kind: "recurring", interval: "month", name: extra.name, amountCents: extra.amountCents, status: "active" },
  ]);
  const subRows = () =>
    db.query.webhookDeliveries.findMany({ where: eq(webhookDeliveries.subscriptionId, sub.id) });
  const orgMembershipRows = () =>
    db.query.webhookDeliveries.findMany({
      where: and(
        eq(webhookDeliveries.event, "membership.changed"),
        sql`${webhookDeliveries.payload}->>'hub_org_id' = ${org.id}`,
      ),
    });

  console.log("1) activation → provision handshake + roster replay, all delivered");
  await db.update(subscriptions).set({ status: "active" }).where(eq(subscriptions.id, sub.id));
  await emitSubscriptionLifecycle(sub.id, "subscription.activated");
  let rows = await subRows();
  const provisionRow = rows.find((r) => r.kind === "provision");
  assert(provisionRow, "provision row queued");
  const roster = await orgMembershipRows();
  assert(roster.length === 2, `roster replay for both members (got ${roster.length})`);
  await deliverAndExpect([...rows.map((r) => r.id), ...roster.map((r) => r.id)], "activation batch");
  const prov = await db.query.subscriptionProvisioning.findFirst({
    where: eq(subscriptionProvisioning.subscriptionId, sub.id),
  });
  assert(prov?.domainUrl, "portal_url persisted from live handshake");
  console.log(`   portal_url: ${prov.domainUrl}`);

  console.log("2) provision idempotency: re-POST returns identical payload, no duplicate tenant");
  const again = await signedPost(
    `${env.MHUB_BASE_URL.replace(/\/+$/, "")}/api/hub/provision`,
    "provision.requested",
    crypto.randomUUID(),
    provisionRow.payload,
  );
  assert(again.status === 200, `provision re-POST 200 (got ${again.status})`);
  assert(again.body?.portal_url === prov.domainUrl, "identical portal_url on re-POST");
  console.log(`   tenant_slug=${again.body?.tenant_slug} events_api_key_prefix=${again.body?.events_api_key_prefix}`);

  console.log("3) roster repeats ACK; MHub mirror converges");
  await emitMembershipChanged({ orgId: org.id, userId: owner.id, role: "owner", action: "added" });
  await emitMembershipChanged({ orgId: org.id, userId: teammate.id, role: "member", action: "added" });
  const repeats = (await orgMembershipRows()).filter((r) => r.status === "pending");
  await deliverAndExpect(repeats.map((r) => r.id), "roster repeats");

  console.log("4) subscription.updated carries Extra location quantity 2 (HUB-4)");
  await emitSubscriptionLifecycle(sub.id, "subscription.updated");
  rows = await subRows();
  const updatedRow = rows.find((r) => r.event === "subscription.updated" && r.status === "pending");
  assert(updatedRow, "updated row queued");
  const addons = (updatedRow.payload as { addon_components: { name: string; quantity: number }[] }).addon_components;
  assert(
    addons.some((a) => a.name === "Extra location" && a.quantity === 2),
    `payload aggregates duplicate rows to quantity 2 (got ${JSON.stringify(addons)})`,
  );
  await deliverAndExpect([updatedRow.id], "updated");

  console.log("5) replaying a processed delivery uuid → duplicate, not reprocessed");
  const replay = await signedPost(env.MHUB_LIFECYCLE_URL, updatedRow.event, updatedRow.deliveryId, {
    event: updatedRow.event,
    data: updatedRow.payload,
  });
  assert(replay.status === 200 && replay.body?.status === "duplicate", `expected duplicate (got ${replay.status} ${JSON.stringify(replay.body)})`);

  console.log("6) unknown event name is ACKed as ignored, never 4xx");
  const unknown = await signedPost(env.MHUB_LIFECYCLE_URL, "subscription.mystery", crypto.randomUUID(), {
    event: "subscription.mystery",
    data: { hub_subscription_id: sub.id, hub_org_id: org.id },
  });
  assert(unknown.status === 200 && unknown.body?.status === "ignored", `expected ignored (got ${unknown.status} ${JSON.stringify(unknown.body)})`);

  console.log("7) status walk: trialing → past_due → suspended → active → canceled");
  const walk: [string, "subscription.updated" | "subscription.past_due" | "subscription.suspended" | "subscription.activated" | "subscription.canceled"][] = [
    ["trialing", "subscription.updated"],
    ["past_due", "subscription.past_due"],
    ["suspended", "subscription.suspended"],
    ["active", "subscription.activated"],
    ["canceled", "subscription.canceled"],
  ];
  for (const [status, event] of walk) {
    await db.update(subscriptions).set({ status: status as never }).where(eq(subscriptions.id, sub.id));
    await emitSubscriptionLifecycle(sub.id, event);
    const row = (await subRows()).find((r) => r.event === event && r.status === "pending");
    assert(row, `${event} queued`);
    assert((row.payload as { status: string }).status === status, `payload status ${status}`);
    await deliverAndExpect([row.id], event);
    console.log(`   ${status} → ${event} delivered`);
  }
  const provisionCount = (await subRows()).filter((r) => r.kind === "provision").length;
  assert(provisionCount === 1, `handshake dedupe held through reactivation (got ${provisionCount})`);

  if (process.env.PARTNER_KEY) {
    console.log("8) partner feed reflects the sub (reconciliation path)");
    const res = await fetch(
      `${env.APP_BASE_URL}/api/partners/subscriptions?product_prefix=marketing-hs-`,
      { headers: { "x-partner-key": process.env.PARTNER_KEY } },
    );
    assert(res.status === 200, `partner feed 200 (got ${res.status})`);
    const feed = (await res.json()) as { subscriptions: { hub_subscription_id: string; status: string; addon_components: { name: string; quantity: number }[] }[] };
    const mine = feed.subscriptions.find((s) => s.hub_subscription_id === sub.id);
    assert(mine && mine.status === "canceled", "feed shows the canceled sub");
    assert(mine.addon_components.some((a) => a.name === "Extra location" && a.quantity === 2), "feed addon quantity 2");
  } else {
    console.log("8) PARTNER_KEY not set — skipping partner feed check");
  }

  console.log("cleanup…");
  await db.delete(webhookDeliveries).where(sql`${webhookDeliveries.payload}->>'hub_org_id' = ${org.id}`);
  await db.delete(organization).where(eq(organization.id, org.id)); // cascades sub → deliveries/provisioning
  await db.delete(user).where(inArray(user.id, [owner.id, teammate.id]));
  console.log(`   done (MHub keeps mirrored tenant "${again.body?.tenant_slug}", churned by the canceled event)`);

  console.log("\n✅ MHUB E2E: ALL PASSED");
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("\n❌", e instanceof Error ? e.message : e);
    await pool.end();
    process.exit(1);
  });
