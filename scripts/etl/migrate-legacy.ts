/**
 * Legacy → production migration (M11). Idempotent: safe to re-run.
 * Env: DATABASE_URL (new prod), OLD_DATABASE_URL (legacy Neon),
 *      BETTER_AUTH_SECRET, APP_BASE_URL.
 * Passwords are NOT migrated (bcrypt → scrypt): users set theirs via
 * the forgot-password flow, which also proves inbox access.
 */
import { createHash } from "node:crypto";
import { Client } from "pg";
import { eq, and } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { auth } from "../../src/lib/auth";
import { member, organization, user } from "../../src/modules/auth/schema";
import { productComponents, products } from "../../src/modules/catalog/schema";
import { subscriptions, subscriptionItems } from "../../src/modules/billing/schema";
import { subscriptionProvisioning } from "../../src/modules/provisioning/schema";
import { ingestKeys } from "../../src/modules/monitoring/schema";
import { promoCodes } from "../../src/modules/promos/schema";
import { toCents } from "../../src/lib/money";

const old = new Client({ connectionString: process.env.OLD_DATABASE_URL });

async function ensureUser(email: string, first: string, last: string, phone: string, ops: boolean) {
  const existing = await db.query.user.findFirst({ where: eq(user.email, email) });
  if (existing) return existing.id;
  await auth.api.signUpEmail({
    body: {
      email,
      password: `Temp-${crypto.randomUUID()}`,
      name: `${first} ${last}`.trim(),
      firstName: first,
      lastName: last,
      phone: phone || "+10000000000",
    },
  });
  const created = await db.query.user.findFirst({ where: eq(user.email, email) });
  await db
    .update(user)
    .set({ emailVerified: true, ...(ops ? { platformRole: "ops_admin" } : {}) })
    .where(eq(user.id, created!.id));
  return created!.id;
}

async function main() {
  await old.connect();
  const summary: string[] = [];

  // Users — kfnawaz is founder (ops) + tenant owner; solutions@ is ops.
  const oldUsers = (await old.query("select * from users")).rows;
  const idMap = new Map<string, string>();
  for (const u of oldUsers) {
    const ops = u.role === "admin" || u.email === "kfnawaz@gmail.com";
    const newId = await ensureUser(u.email, u.first_name ?? "", u.last_name ?? "", u.phone ?? "", ops);
    idMap.set(u.id, newId);
    summary.push(`user ${u.email} → ${ops ? "ops_admin" : "customer"}`);
  }

  // Tenant + Stripe customer (moves from owner user to the tenant — PRD §2)
  const [t] = (await old.query("select * from tenants")).rows;
  let orgId: string;
  const existingOrg = await db.query.organization.findFirst({ where: eq(organization.slug, t.slug) });
  if (existingOrg) {
    orgId = existingOrg.id;
  } else {
    const owner = oldUsers.find((u) => u.id === t.owner_id);
    const [org] = await db
      .insert(organization)
      .values({
        id: crypto.randomUUID(),
        name: t.name,
        slug: t.slug,
        status: t.status ?? "active",
        stripeCustomerId: owner?.stripe_customer_id ?? null,
        createdAt: new Date(),
      })
      .returning();
    orgId = org.id;
    for (const m of (await old.query("select * from tenant_memberships")).rows) {
      if (m.tenant_id !== t.id) continue;
      await db.insert(member).values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        userId: idMap.get(m.user_id)!,
        role: m.role === "read_only" ? "member" : m.role,
        createdAt: new Date(),
      });
    }
    summary.push(`tenant ${t.name} (${t.slug}) + stripe customer`);
  }

  // Subscription + items + provisioning + ingest key
  const prodRows = await db.query.products.findMany();
  const oldProducts = (await old.query("select id, slug from products")).rows;
  for (const s of (await old.query("select * from subscriptions")).rows) {
    const slug = oldProducts.find((p) => p.id === s.product_id)?.slug;
    const newProduct = prodRows.find((p) => p.slug === slug);
    if (!newProduct) continue;
    const existing = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.tenantId, orgId), eq(subscriptions.productId, newProduct.id)),
    });
    if (existing) continue;
    const [sub] = await db
      .insert(subscriptions)
      .values({
        tenantId: orgId,
        productId: newProduct.id,
        status: s.status === "active" ? "active" : "canceled",
        stripeSubscriptionId: s.stripe_subscription_id || null,
        monthlyHostingCents: s.monthly_hosting_cents ?? null,
        subscribedAt: s.subscribed_at ?? new Date(),
      })
      .returning();
    const comps = await db.query.productComponents.findMany({
      where: eq(productComponents.productId, newProduct.id),
    });
    for (const it of (await old.query("select * from subscription_items where subscription_id=$1", [s.id])).rows) {
      const comp = comps.find((c) => c.name === it.name);
      await db.insert(subscriptionItems).values({
        subscriptionId: sub.id,
        componentId: comp?.id ?? comps[0]?.id ?? (await db.query.productComponents.findFirst())!.id,
        kind: it.kind,
        name: it.name,
        amountCents: toCents(it.amount),
        status: it.status === "canceled" ? "canceled" : it.status === "paid" ? "paid" : it.kind === "one_time" ? "pending" : "active",
        stripeSubscriptionItemId: it.stripe_subscription_item_id ?? null,
      });
    }
    if (s.domain_url) {
      await db.insert(subscriptionProvisioning).values({ subscriptionId: sub.id, domainUrl: s.domain_url }).onConflictDoNothing();
    }
    if (s.metrics_api_key) {
      // Hash-import so the deployed reporter keeps working untouched (PRD M11).
      await db.insert(ingestKeys).values({
        subscriptionId: sub.id,
        prefix: s.metrics_api_key.slice(0, 12),
        keyHash: createHash("sha256").update(s.metrics_api_key).digest("hex"),
      }).onConflictDoNothing();
    }
    summary.push(`subscription ${slug} (${s.status}) + provisioning + ingest key`);
  }

  // Promo codes
  for (const p of (await old.query("select * from promo_codes")).rows) {
    const exists = await db.query.promoCodes.findFirst({ where: eq(promoCodes.code, p.code) });
    if (exists) continue;
    await db.insert(promoCodes).values({
      code: p.code,
      kind: p.kind,
      percentOff: p.kind === "percent_off" ? Math.round(Number(p.amount)) : null,
      amountCents: p.kind === "amount_off" || p.kind === "fixed_price" ? toCents(p.amount) : null,
      freePeriods: p.kind === "free_periods" ? Math.round(Number(p.amount)) : null,
      duration: p.duration,
      durationMonths: p.duration_in_periods ?? null,
      isPublic: p.is_public,
      autoApply: p.auto_apply,
      isActive: p.is_active,
    });
    summary.push(`promo ${p.code}`);
  }

  console.log("MIGRATED:\n  " + summary.join("\n  "));
  await old.end();
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("❌", e);
    await old.end().catch(() => {});
    await pool.end();
    process.exit(1);
  });
