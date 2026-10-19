/**
 * Ops: bring an EXISTING partner-app shop (e.g. a Fixorata org) onto Hub
 * billing at agreed terms — the audited, scripted form of "link existing,
 * then start subscription" for shops that predate the integration.
 *
 *  1. Find or create the Hub owner account (no password, no Hub emails).
 *  2. Create the Hub client and link it to the partner's tenant id.
 *  3. Set a negotiated price (tenant price override) when it differs from list.
 *  4. Start the subscription: no trial, nothing due today, first charge on
 *     --first-charge (and every period after); the owner saves a card from
 *     the partner app's billing page meanwhile.
 *
 * Every step is in Hub's audit log as the --actor ops admin. Dry run unless
 * --apply. Idempotent: an already-linked shop is reported, not re-created.
 *
 * node --import tsx scripts/partner-link-shop.ts --app fixorata \
 *   --external <partner org id> --name "EZ Wireless" \
 *   --owner-email owner@shop.com --owner-name "Owner Name" \
 *   --price-cents 3500 --first-charge 2026-11-01 --actor ops@plaidware.com [--apply]
 */
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { PLACEHOLDER_PHONE } from "../src/lib/phone";
import { user } from "../src/modules/auth/schema";
import { writeAudit } from "../src/modules/audit/service";
import { setTenantPriceOverride } from "../src/modules/billing/ar-service";
import { createCheckout } from "../src/modules/billing/service";
import { productComponents, products } from "../src/modules/catalog/schema";
import { partnerApps } from "../src/modules/partners/schema";
import { hubTenantIdFor, linkPartnerTenant } from "../src/modules/partners/service";
import { slugMatchesPrefixes } from "../src/modules/partners/logic";
import { createTenantWithOwner, uniqueSlug } from "../src/modules/tenancy/service";

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** 08:00 UTC on the given day — the same hour Hub's other 1st-of-month billing runs. */
function firstChargeInstant(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("--first-charge must be YYYY-MM-DD");
  const d = new Date(`${day}T08:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error("--first-charge is not a date");
  return d;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const appName = arg("--app");
  const external = arg("--external");
  const name = arg("--name");
  const ownerEmail = arg("--owner-email")?.trim().toLowerCase();
  const ownerName = arg("--owner-name") ?? "";
  const priceCents = Number(arg("--price-cents"));
  const firstCharge = firstChargeInstant(arg("--first-charge") ?? "");
  const actorEmail = arg("--actor")?.trim().toLowerCase();
  if (!appName || !external || !name || !ownerEmail || !Number.isInteger(priceCents) || priceCents <= 0 || !actorEmail) {
    throw new Error("Required: --app --external --name --owner-email --price-cents --first-charge --actor (see header)");
  }

  const app = await db.query.partnerApps.findFirst({ where: eq(partnerApps.name, appName) });
  if (!app || app.status !== "active") throw new Error(`No active partner app "${appName}"`);
  const actor = await db.query.user.findFirst({ where: eq(user.email, actorEmail) });
  if (!actor || actor.platformRole !== "ops_admin") throw new Error(`--actor ${actorEmail} is not an ops admin here`);
  const product = (await db.query.products.findMany({ where: eq(products.isActive, true) })).find((p) =>
    slugMatchesPrefixes(app.productPrefixes, p.slug),
  );
  if (!product) throw new Error(`No active product for ${appName}`);
  const base = await db.query.productComponents.findFirst({
    where: and(eq(productComponents.productId, product.id), eq(productComponents.role, "base")),
  });
  if (!base) throw new Error(`${product.slug} has no base charge`);
  const existingTenant = await hubTenantIdFor(app.id, external);
  const existingUser = await db.query.user.findFirst({ where: eq(user.email, ownerEmail) });

  console.log(`${apply ? "APPLY" : "DRY RUN"} — ${app.displayName} shop "${name}" (${external})`);
  console.log(`  product ${product.slug}: list ${base.amountCents}¢/${base.interval}; agreed ${priceCents}¢ → plan ${priceCents === base.amountCents ? "standard" : "custom"}`);
  console.log(`  first charge ${firstCharge.toISOString()} (nothing due today, no trial)`);
  console.log(`  owner ${ownerEmail}: ${existingUser ? "existing Hub account" : "new Hub account (no password, no Hub emails)"}`);
  if (existingTenant) {
    console.log(`  already linked to Hub client ${existingTenant} — nothing to do.`);
    return;
  }
  if (!apply) {
    console.log("  dry run: pass --apply to create, link and start.");
    return;
  }

  let owner = existingUser;
  if (!owner) {
    const [first, ...rest] = (ownerName || name).trim().split(/\s+/);
    const now = new Date();
    [owner] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: ownerName || name,
        email: ownerEmail,
        emailVerified: false,
        firstName: first || "Owner",
        lastName: rest.join(" ") || "-",
        phone: PLACEHOLDER_PHONE,
        platformRole: "customer",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  }
  const org = await createTenantWithOwner({ name, slug: await uniqueSlug(name), ownerUserId: owner.id });
  const linked = await linkPartnerTenant({
    partnerAppId: app.id,
    tenantId: org.id,
    externalTenantId: external,
    linkedBy: `ops:${actor.id}`,
  });
  if (!linked.ok) throw new Error(`Link refused (${linked.reason}) — the shop or this client is linked elsewhere`);
  await writeAudit({
    tenantId: org.id,
    actorUserId: actor.id,
    kind: "partner_link_set",
    payload: { app: app.displayName, externalTenantId: external, via: "ops script" },
  });
  if (priceCents !== base.amountCents) {
    await setTenantPriceOverride({ tenantId: org.id, componentId: base.id, amountCents: priceCents, actorUserId: actor.id });
  }
  const r = await createCheckout({
    tenantId: org.id,
    productId: product.id,
    componentIds: [],
    contact: { email: ownerEmail, name: ownerName || name },
    userId: actor.id,
    skipTrial: true,
    skipAutoPromos: true,
    itemPlan: [{ componentId: base.id, amountCents: priceCents, quantity: 1 }],
    firstChargeAt: firstCharge,
  });
  await writeAudit({
    tenantId: org.id,
    subscriptionId: r.subscriptionId,
    actorUserId: actor.id,
    kind: "subscription_started_by_ops",
    payload: { collection: "card_from_partner_app", firstChargeOn: firstCharge.toISOString().slice(0, 10), firstInvoiceCents: r.firstInvoice?.amountDueCents ?? 0 },
  });
  console.log(`  ✅ Hub client ${org.id}, subscription ${r.subscriptionId}: ${r.status}; due today ${r.firstInvoice?.amountDueCents ?? 0}¢; card step: ${r.mode}`);
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("❌", e instanceof Error ? e.message : e);
    await pool.end();
    process.exit(1);
  });
