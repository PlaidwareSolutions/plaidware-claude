import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { db } from "../../db";
import { encryptSecret } from "../../lib/crypto";
import { writeAudit } from "../audit/service";
import { LIVE_SUBSCRIPTION_STATUSES } from "../billing/mappers";
import { subscriptions, tenantPriceOverrides } from "../billing/schema";
import { productComponents, products } from "../catalog/schema";
import { hashPartnerKey, IDEMPOTENCY_TTL_MS, normalizeOrigin, planKeyFor, prefixProblem, slugMatchesPrefixes } from "./logic";
import { partnerApps, partnerIdempotency, partnerKeys, partnerPayLinks, partnerTenantLinks } from "./schema";

export async function mintPartnerKey(
  name: string,
  productPrefixes: string[],
  partnerAppId: string | null = null,
): Promise<{ id: string; raw: string }> {
  const raw = `ppk_${randomBytes(24).toString("hex")}`;
  const [row] = await db
    .insert(partnerKeys)
    .values({
      name,
      prefix: raw.slice(0, 12),
      keyHash: hashPartnerKey(raw),
      productPrefixes,
      partnerAppId,
    })
    .returning({ id: partnerKeys.id });
  return { id: row.id, raw };
}

/** The active key row for a presented raw key, or null. */
export async function resolvePartnerKey(rawKey: string) {
  const row = await db.query.partnerKeys.findFirst({
    where: and(eq(partnerKeys.keyHash, hashPartnerKey(rawKey)), isNull(partnerKeys.revokedAt)),
  });
  return row ?? null;
}

export async function revokePartnerKey(id: string): Promise<void> {
  await db
    .update(partnerKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(partnerKeys.id, id), isNull(partnerKeys.revokedAt)));
}

export type LinkResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "external_taken" | "tenant_taken" };

/**
 * Link a Hub tenant to a partner app's tenant id. Idempotent for the same
 * pair; refuses (never steals) when either side is already linked to
 * something else — re-linking is an explicit unlink first.
 */
export async function linkPartnerTenant(opts: {
  partnerAppId: string;
  tenantId: string;
  externalTenantId: string;
  linkedBy: string;
}): Promise<LinkResult> {
  const existing = await db.query.partnerTenantLinks.findMany({
    where: and(
      eq(partnerTenantLinks.partnerAppId, opts.partnerAppId),
      or(
        eq(partnerTenantLinks.tenantId, opts.tenantId),
        eq(partnerTenantLinks.externalTenantId, opts.externalTenantId),
      ),
    ),
  });
  const same = existing.find(
    (l) => l.tenantId === opts.tenantId && l.externalTenantId === opts.externalTenantId,
  );
  if (same) return { ok: true, changed: false };
  if (existing.some((l) => l.externalTenantId === opts.externalTenantId)) {
    return { ok: false, reason: "external_taken" };
  }
  if (existing.some((l) => l.tenantId === opts.tenantId)) {
    return { ok: false, reason: "tenant_taken" };
  }
  const inserted = await db
    .insert(partnerTenantLinks)
    .values(opts)
    .onConflictDoNothing()
    .returning({ id: partnerTenantLinks.id });
  // Lost a race to a concurrent link: re-read and report what won.
  if (inserted.length === 0) return linkPartnerTenant(opts);
  return { ok: true, changed: true };
}

export async function unlinkPartnerTenant(partnerAppId: string, tenantId: string): Promise<boolean> {
  const rows = await db
    .delete(partnerTenantLinks)
    .where(and(eq(partnerTenantLinks.partnerAppId, partnerAppId), eq(partnerTenantLinks.tenantId, tenantId)))
    .returning({ id: partnerTenantLinks.id });
  return rows.length > 0;
}

/** The partner's tenant id for a Hub tenant, or null when unlinked. */
export async function externalTenantIdFor(partnerAppId: string, tenantId: string): Promise<string | null> {
  const row = await db.query.partnerTenantLinks.findFirst({
    where: and(eq(partnerTenantLinks.partnerAppId, partnerAppId), eq(partnerTenantLinks.tenantId, tenantId)),
  });
  return row?.externalTenantId ?? null;
}

/** The Hub tenant for a partner's tenant id, or null when unlinked. */
export async function hubTenantIdFor(partnerAppId: string, externalTenantId: string): Promise<string | null> {
  const row = await db.query.partnerTenantLinks.findFirst({
    where: and(
      eq(partnerTenantLinks.partnerAppId, partnerAppId),
      eq(partnerTenantLinks.externalTenantId, externalTenantId),
    ),
  });
  return row?.tenantId ?? null;
}

// ---------------------------------------------------------------------------
// Partner app administration (Ops → System → Partners). Platform-level
// audit rows (tenantId null).
// ---------------------------------------------------------------------------

export type PartnerAppInput = {
  name: string;
  displayName: string;
  productPrefixes: string[];
  webhookUrl: string | null;
  provisionUrl: string | null;
  billingUrl: string | null;
  allowedReturnOrigins: string[];
};

async function validateApp(input: PartnerAppInput, selfId: string | null): Promise<PartnerAppInput> {
  const others = await db.query.partnerApps.findMany({
    where: selfId ? ne(partnerApps.id, selfId) : undefined,
  });
  const prefixes = [...new Set(input.productPrefixes.map((p) => p.trim().toLowerCase()).filter(Boolean))];
  const problem = prefixProblem(
    prefixes,
    others.map((o) => ({ name: o.displayName, prefixes: o.productPrefixes })),
  );
  if (problem) throw new Error(problem);
  const origins: string[] = [];
  for (const raw of input.allowedReturnOrigins.filter((o) => o.trim())) {
    const o = normalizeOrigin(raw);
    if (!o) throw new Error(`"${raw}" isn't an https origin (http is allowed only for localhost)`);
    if (!origins.includes(o)) origins.push(o);
  }
  for (const [label, url] of [["Webhook URL", input.webhookUrl], ["Provision URL", input.provisionUrl], ["Billing page URL", input.billingUrl]] as const) {
    if (url && !normalizeOrigin(url)) throw new Error(`${label} must be https (http only for localhost)`);
  }
  return { ...input, productPrefixes: prefixes, allowedReturnOrigins: origins };
}

export async function createPartnerApp(input: PartnerAppInput, actorUserId: string | null): Promise<string> {
  const v = await validateApp(input, null);
  const taken = await db.query.partnerApps.findFirst({ where: eq(partnerApps.name, v.name) });
  if (taken) throw new Error(`A partner app named "${v.name}" already exists`);
  const [row] = await db.insert(partnerApps).values(v).returning({ id: partnerApps.id });
  await writeAudit({ tenantId: null, actorUserId, kind: "partner_app_created", payload: { app: v.displayName, prefixes: v.productPrefixes } });
  return row.id;
}

export async function updatePartnerApp(id: string, input: Omit<PartnerAppInput, "name">, actorUserId: string | null) {
  const app = await db.query.partnerApps.findFirst({ where: eq(partnerApps.id, id) });
  if (!app) throw new Error("Partner app not found");
  const v = await validateApp({ ...input, name: app.name }, id);
  await db
    .update(partnerApps)
    .set({
      displayName: v.displayName,
      productPrefixes: v.productPrefixes,
      webhookUrl: v.webhookUrl,
      provisionUrl: v.provisionUrl,
      billingUrl: v.billingUrl,
      allowedReturnOrigins: v.allowedReturnOrigins,
    })
    .where(eq(partnerApps.id, id));
  await writeAudit({ tenantId: null, actorUserId, kind: "partner_app_updated", payload: { app: v.displayName } });
}

export async function setPartnerAppStatus(id: string, status: "active" | "disabled", actorUserId: string) {
  const [row] = await db
    .update(partnerApps)
    .set({ status })
    .where(eq(partnerApps.id, id))
    .returning({ displayName: partnerApps.displayName });
  if (!row) throw new Error("Partner app not found");
  await writeAudit({ tenantId: null, actorUserId, kind: "partner_app_status_changed", payload: { app: row.displayName, after: status } });
}

/** New HMAC secret; returned once for the partner's env, stored sealed. */
export async function rotatePartnerWebhookSecret(id: string, actorUserId: string | null): Promise<string> {
  const secret = `pws_${randomBytes(32).toString("hex")}`;
  const [row] = await db
    .update(partnerApps)
    .set({ webhookSecretEnc: encryptSecret(secret) })
    .where(eq(partnerApps.id, id))
    .returning({ displayName: partnerApps.displayName });
  if (!row) throw new Error("Partner app not found");
  await writeAudit({ tenantId: null, actorUserId, kind: "partner_secret_rotated", payload: { app: row.displayName } });
  return secret;
}

/** API key for the app (scoped to its prefixes); the raw key is returned once. */
export async function mintPartnerAppKey(id: string, label: string, actorUserId: string | null) {
  const app = await db.query.partnerApps.findFirst({ where: eq(partnerApps.id, id) });
  if (!app) throw new Error("Partner app not found");
  const minted = await mintPartnerKey(label.trim() || `${app.name}-${new Date().toISOString().slice(0, 10)}`, app.productPrefixes, app.id);
  await writeAudit({ tenantId: null, actorUserId, kind: "partner_key_minted", payload: { app: app.displayName, prefix: minted.raw.slice(0, 12) } });
  return minted;
}

export async function revokePartnerAppKey(keyId: string, actorUserId: string) {
  const key = await db.query.partnerKeys.findFirst({ where: eq(partnerKeys.id, keyId) });
  if (!key) throw new Error("Key not found");
  await revokePartnerKey(keyId);
  await writeAudit({ tenantId: null, actorUserId, kind: "partner_key_revoked", payload: { prefix: key.prefix, name: key.name } });
}

/** Ops links a client to an existing partner tenant (provisioning tab). */
export async function setTenantLinkByOps(opts: {
  partnerAppId: string;
  tenantId: string;
  externalTenantId: string;
  actorUserId: string;
}) {
  const app = await db.query.partnerApps.findFirst({ where: eq(partnerApps.id, opts.partnerAppId) });
  if (!app) throw new Error("Partner app not found");
  const external = opts.externalTenantId.trim();
  if (!external) throw new Error("Enter the partner's tenant id");
  const res = await linkPartnerTenant({
    partnerAppId: app.id,
    tenantId: opts.tenantId,
    externalTenantId: external,
    linkedBy: `ops:${opts.actorUserId}`,
  });
  if (!res.ok) {
    throw new Error(
      res.reason === "external_taken"
        ? `That ${app.displayName} tenant is already linked to another client`
        : `This client is already linked to a ${app.displayName} tenant — unlink it first`,
    );
  }
  if (res.changed) {
    await writeAudit({
      tenantId: opts.tenantId,
      actorUserId: opts.actorUserId,
      kind: "partner_link_set",
      payload: { app: app.displayName, externalTenantId: external, via: "ops" },
    });
  }
}

export async function removeTenantLinkByOps(opts: { partnerAppId: string; tenantId: string; actorUserId: string }) {
  const app = await db.query.partnerApps.findFirst({ where: eq(partnerApps.id, opts.partnerAppId) });
  const external = await externalTenantIdFor(opts.partnerAppId, opts.tenantId);
  if (!app || !external) return;
  await unlinkPartnerTenant(opts.partnerAppId, opts.tenantId);
  await writeAudit({
    tenantId: opts.tenantId,
    actorUserId: opts.actorUserId,
    kind: "partner_link_removed",
    payload: { app: app.displayName, externalTenantId: external, via: "ops" },
  });
}

/** Daily sweep: expired Idempotency-Key rows and pay links a week past expiry. */
export async function purgePartnerLedgers(now = new Date()): Promise<{ idempotency: number; payLinks: number }> {
  const idem = await db
    .delete(partnerIdempotency)
    .where(lt(partnerIdempotency.createdAt, new Date(now.getTime() - IDEMPOTENCY_TTL_MS)))
    .returning({ id: partnerIdempotency.id });
  const links = await db
    .delete(partnerPayLinks)
    .where(lt(partnerPayLinks.expiresAt, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)))
    .returning({ id: partnerPayLinks.id });
  return { idempotency: idem.length, payLinks: links.length };
}

/**
 * Where a client manages billing, for links in Hub's billing emails: the
 * partner app's billing page (with `?org=<external_tenant_id>`) when every
 * live subscription the client has belongs to one linked partner app with a
 * billing URL (its owners have no Hub password), otherwise Hub's /billing.
 */
export async function billingPageUrlFor(tenantId: string, hubBillingUrl: string): Promise<string> {
  const [links, live] = await Promise.all([
    db.query.partnerTenantLinks.findMany({ where: eq(partnerTenantLinks.tenantId, tenantId) }),
    db
      .select({ slug: products.slug })
      .from(subscriptions)
      .innerJoin(products, eq(subscriptions.productId, products.id))
      .where(and(eq(subscriptions.tenantId, tenantId), inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]))),
  ]);
  if (links.length !== 1) return hubBillingUrl;
  const app = await db.query.partnerApps.findFirst({ where: eq(partnerApps.id, links[0].partnerAppId) });
  if (!app?.billingUrl) return hubBillingUrl;
  if (!live.every((s) => slugMatchesPrefixes(app.productPrefixes, s.slug))) return hubBillingUrl;
  // ?org= tells a multi-shop owner's session which shop the email is about.
  const url = new URL(app.billingUrl);
  url.searchParams.set("org", links[0].externalTenantId);
  return url.toString();
}

/** plan_key for a client's subscription to a product (see logic.planKeyFor). */
export async function partnerPlanKey(tenantId: string, productId: string) {
  const base = await db.query.productComponents.findFirst({
    where: and(eq(productComponents.productId, productId), eq(productComponents.role, "base")),
    columns: { id: true },
  });
  if (!base) return planKeyFor(false);
  const override = await db.query.tenantPriceOverrides.findFirst({
    where: and(eq(tenantPriceOverrides.tenantId, tenantId), eq(tenantPriceOverrides.componentId, base.id)),
    columns: { id: true },
  });
  return planKeyFor(Boolean(override));
}

/** The partner-maintained billing contact for a client, if any (see partner_tenant_links.billingEmail). */
export async function billingContactOverride(tenantId: string): Promise<string | null> {
  const links = await db.query.partnerTenantLinks.findMany({
    where: eq(partnerTenantLinks.tenantId, tenantId),
    columns: { billingEmail: true },
  });
  return links.find((l) => l.billingEmail)?.billingEmail ?? null;
}
