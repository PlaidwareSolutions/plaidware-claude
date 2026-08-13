/**
 * Ingest + monitoring smoke (dev server running).
 * Run: node --env-file=.env --import tsx scripts/smoke-ingest.ts
 */
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { member, organization, user } from "../src/modules/auth/schema";
import { products } from "../src/modules/catalog/schema";
import { subscriptions } from "../src/modules/billing/schema";
import { healthChecks, metricIngestEvents, usageRecords } from "../src/modules/monitoring/schema";
import {
  getActiveIncidents,
  acknowledgeIncident,
  mintIngestKey,
  subscriptionKpis,
} from "../src/modules/monitoring/service";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  const uid = `mon_${Date.now()}`;
  const [u] = await db.insert(user).values({
    id: uid, name: "Mon Tester", email: `${uid}@example.com`, emailVerified: true,
    firstName: "Mon", lastName: "Tester", phone: "+15550004444",
    createdAt: new Date(), updatedAt: new Date(),
  }).returning();
  const [org] = await db.insert(organization).values({
    id: crypto.randomUUID(), name: "Mon Corp", slug: `mon-${Date.now()}`, status: "active", createdAt: new Date(),
  }).returning();
  await db.insert(member).values({ id: crypto.randomUUID(), organizationId: org.id, userId: u.id, role: "owner", createdAt: new Date() });
  const website = await db.query.products.findFirst({ where: eq(products.slug, "company-website") });
  const [sub] = await db.insert(subscriptions).values({ tenantId: org.id, productId: website!.id, status: "active" }).returning();

  console.log("1) mint key + authorized ingest…");
  const key = await mintIngestKey(sub.id);
  assert(key.startsWith("pwk_") && key.length > 40, "key shape");
  const res = await fetch(`${BASE}/api/metrics/ingest`, {
    method: "POST",
    headers: { "x-metrics-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      events: [
        { metric: "status", metadata: { value: "healthy" } },
        { metric: "response_time_ms", quantity: 132 },
        { metric: "page_views", quantity: 500 },
        { metric: "mystery_metric", quantity: 7 },
      ],
    }),
  });
  const body = await res.json();
  assert(res.status === 200, `ingest ${res.status}`);
  assert(body.accepted === 3 && body.unknownKeys.includes("mystery_metric"), `response ${JSON.stringify(body)}`);

  const hc = await db.query.healthChecks.findFirst({ where: eq(healthChecks.subscriptionId, sub.id) });
  assert(hc?.source === "reporter" && hc.status === "healthy" && hc.responseTimeMs === 132, "reporter health row");
  const ur = await db.query.usageRecords.findMany({ where: eq(usageRecords.subscriptionId, sub.id) });
  assert(ur.length === 2, "usage rows");
  const ev = await db.query.metricIngestEvents.findFirst({ where: eq(metricIngestEvents.subscriptionId, sub.id) });
  assert(ev?.ok && ev.unknownKeys.includes("mystery_metric"), "ingest event logged with drift");

  console.log("2) invalid key is rejected, nothing persisted…");
  const bad = await fetch(`${BASE}/api/metrics/ingest`, {
    method: "POST",
    headers: { "x-metrics-key": "pwk_invalid", "Content-Type": "application/json" },
    body: JSON.stringify({ events: [{ metric: "page_views", quantity: 1 }] }),
  });
  assert(bad.status === 401, `bad key ${bad.status}`);

  console.log("3) rotation revokes the old key…");
  await mintIngestKey(sub.id);
  const revoked = await fetch(`${BASE}/api/metrics/ingest`, {
    method: "POST",
    headers: { "x-metrics-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ events: [{ metric: "page_views", quantity: 1 }] }),
  });
  assert(revoked.status === 401, "old key revoked");

  console.log("4) KPI rollup sees the data…");
  const kpis = await subscriptionKpis(sub.id, website!.id);
  const pv = kpis.find((k) => k.key === "page_views");
  assert(pv?.current === 500 && pv.isPrimary, "page_views KPI");

  console.log("5) incident + ack-pinned re-arm…");
  const [failing] = await db.insert(healthChecks).values({
    subscriptionId: sub.id, source: "probe", status: "down", detail: "smoke",
  }).returning();
  let incidents = await getActiveIncidents();
  assert(incidents.some((i) => i.subscriptionId === sub.id), "incident visible");
  await acknowledgeIncident(failing.id, sub.id, u.id, "known issue");
  incidents = await getActiveIncidents();
  assert(!incidents.some((i) => i.subscriptionId === sub.id), "acked incident hidden");
  await db.insert(healthChecks).values({ subscriptionId: sub.id, source: "probe", status: "down" });
  incidents = await getActiveIncidents();
  assert(incidents.some((i) => i.subscriptionId === sub.id), "new failure re-alerts");

  console.log("cleanup…");
  await db.delete(organization).where(eq(organization.id, org.id));
  await db.delete(user).where(eq(user.id, u.id));
  console.log("\n✅ MONITORING SMOKE: ALL PASSED");
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("\n❌", e.message);
    await pool.end();
    process.exit(1);
  });
