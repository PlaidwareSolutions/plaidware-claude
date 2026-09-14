import dns from "node:dns/promises";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { encryptSecret, decryptSecret } from "../../lib/crypto";
import { writeAudit } from "../audit/service";
import { products } from "../catalog/schema";
import { isMarketingSlug } from "../webhooks_out/logic";
import { resolveDnsDefaults } from "./defaults";
import { subscriptions } from "../billing/schema";
import { provisioningCredentials, subscriptionProvisioning } from "./schema";
import { verifyDomain, type DnsResolver, type VerifyResult } from "./dns-verifier";

const realResolver: DnsResolver = {
  resolveTxt: (h) => dns.resolveTxt(h),
  resolveCname: (h) => dns.resolveCname(h),
  resolve4: (h) => dns.resolve4(h),
};

export async function getOrCreateProvisioning(subscriptionId: string) {
  const existing = await db.query.subscriptionProvisioning.findFirst({
    where: eq(subscriptionProvisioning.subscriptionId, subscriptionId),
  });
  if (existing) return existing;
  // A new row starts from the product's DNS defaults (then the platform env).
  const [product] = await db
    .select({ defaultExpectedCname: products.defaultExpectedCname, defaultExpectedAIps: products.defaultExpectedAIps })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  const defaults = resolveDnsDefaults(product);
  const [row] = await db
    .insert(subscriptionProvisioning)
    .values({ subscriptionId, expectedCname: defaults.expectedCname, expectedAIps: defaults.expectedAIps })
    .onConflictDoNothing({ target: subscriptionProvisioning.subscriptionId })
    .returning();
  return (
    row ??
    (await db.query.subscriptionProvisioning.findFirst({
      where: eq(subscriptionProvisioning.subscriptionId, subscriptionId),
    }))!
  );
}

async function subscriptionTenant(subscriptionId: string): Promise<string> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
    columns: { tenantId: true },
  });
  if (!sub) throw new Error("Subscription not found");
  return sub.tenantId;
}

async function subscriptionProductSlug(subscriptionId: string): Promise<string | null> {
  const [row] = await db
    .select({ slug: products.slug })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  return row?.slug ?? null;
}

/**
 * Sets the live domain and resets the last verification. For Hub-hosted
 * products a first domain also mints the verification token and fills the
 * routing targets from defaults, so "unconfigured" can't happen by accident.
 */
export async function setDomain(
  subscriptionId: string,
  domainUrl: string | null,
  actorUserId: string,
): Promise<void> {
  const prov = await getOrCreateProvisioning(subscriptionId);
  const before = prov.domainUrl;
  await db
    .update(subscriptionProvisioning)
    .set({ domainUrl, dnsLastOk: null, dnsLastResolved: null, dnsLastVerifiedAt: null })
    .where(eq(subscriptionProvisioning.id, prov.id));
  await writeAudit({
    tenantId: await subscriptionTenant(subscriptionId),
    subscriptionId,
    actorUserId,
    kind: "domain_changed",
    payload: { before, after: domainUrl },
  });
  if (domainUrl && !prov.verifyToken) {
    const slug = await subscriptionProductSlug(subscriptionId);
    if (slug && !isMarketingSlug(slug)) {
      await configureVerification(subscriptionId, actorUserId, { auto: true });
    }
  }
}

/**
 * One-click verification setup: mints a TXT token when there is none and
 * fills empty CNAME / A targets from the defaults. Existing values are kept.
 */
export async function configureVerification(
  subscriptionId: string,
  actorUserId: string,
  opts: { auto?: boolean } = {},
): Promise<{ verifyToken: string; expectedCname: string | null; expectedAIps: string | null }> {
  const prov = await getOrCreateProvisioning(subscriptionId);
  const defaults = resolveDnsDefaults();
  const next = {
    verifyToken: prov.verifyToken ?? crypto.randomUUID(),
    expectedCname: prov.expectedCname ?? defaults.expectedCname,
    expectedAIps: prov.expectedAIps ?? defaults.expectedAIps,
  };
  await db.update(subscriptionProvisioning).set(next).where(eq(subscriptionProvisioning.id, prov.id));
  await writeAudit({
    tenantId: await subscriptionTenant(subscriptionId),
    subscriptionId,
    actorUserId,
    kind: "dns_config_changed",
    payload: {
      hasToken: true,
      expectedCname: next.expectedCname,
      expectedAIps: next.expectedAIps,
      auto: Boolean(opts.auto),
    },
  });
  return next;
}

/**
 * MHub provisioning handshake result (integration contract §C): the returned
 * portal URL is stored as the subscription's domainUrl. DNS-verification
 * fields stay null for marketing-* products — their domain is MHub's, never
 * DNS-checked by Hub.
 */
export async function setPortalUrl(subscriptionId: string, portalUrl: string): Promise<void> {
  const prov = await getOrCreateProvisioning(subscriptionId);
  await db
    .update(subscriptionProvisioning)
    .set({ domainUrl: portalUrl })
    .where(eq(subscriptionProvisioning.id, prov.id));
  await writeAudit({
    tenantId: await subscriptionTenant(subscriptionId),
    subscriptionId,
    kind: "domain_changed",
    payload: { before: prov.domainUrl, after: portalUrl, source: "mhub_provision" },
  });
}

export async function setVerificationConfig(
  subscriptionId: string,
  config: { verifyToken?: string | null; expectedCname?: string | null; expectedAIps?: string | null },
  actorUserId: string,
): Promise<void> {
  const prov = await getOrCreateProvisioning(subscriptionId);
  // Accept a bare token or the full `plaidware-verify=<token>` string.
  const token = config.verifyToken?.trim().replace(/^plaidware-verify=/i, "") || null;
  await db
    .update(subscriptionProvisioning)
    .set({
      verifyToken: token,
      expectedCname: config.expectedCname?.trim() || null,
      expectedAIps: config.expectedAIps?.trim() || null,
    })
    .where(eq(subscriptionProvisioning.id, prov.id));
  await writeAudit({
    tenantId: await subscriptionTenant(subscriptionId),
    subscriptionId,
    actorUserId,
    kind: "dns_config_changed",
    payload: {
      hasToken: Boolean(token),
      expectedCname: config.expectedCname || null,
      expectedAIps: config.expectedAIps || null,
    },
  });
}

export async function runDnsVerification(
  subscriptionId: string,
  actorUserId: string,
  resolver: DnsResolver = realResolver,
): Promise<VerifyResult> {
  const prov = await getOrCreateProvisioning(subscriptionId);
  if (!prov.domainUrl) throw new Error("Set a live domain first");
  const result = await verifyDomain(
    {
      domainUrl: prov.domainUrl,
      verifyToken: prov.verifyToken,
      expectedCname: prov.expectedCname,
      expectedAIps: prov.expectedAIps?.split(",").map((s) => s.trim()).filter(Boolean) ?? null,
    },
    resolver,
  );
  await db
    .update(subscriptionProvisioning)
    .set({
      dnsLastVerifiedAt: new Date(),
      dnsLastResolved: result.resolved.join(", ").slice(0, 500),
      dnsLastOk: result.ok,
    })
    .where(eq(subscriptionProvisioning.id, prov.id));
  await writeAudit({
    tenantId: await subscriptionTenant(subscriptionId),
    subscriptionId,
    actorUserId,
    kind: "dns_verified",
    payload: { ok: result.ok, mode: result.mode, detail: result.detail },
  });
  return result;
}

// ---------------------------------------------------------------------------
// Encrypted credentials (PRD §4.7)
// ---------------------------------------------------------------------------

export async function upsertCredential(opts: {
  id?: string;
  subscriptionId: string;
  kind: "registrar" | "dns" | "email" | "hosting" | "other";
  label: string;
  url?: string | null;
  username?: string | null;
  secret?: string | null; // plaintext in, encrypted at rest; null keeps existing
  actorUserId: string;
}): Promise<void> {
  const values = {
    kind: opts.kind,
    label: opts.label,
    url: opts.url ?? null,
    username: opts.username ?? null,
  };
  if (opts.id) {
    await db
      .update(provisioningCredentials)
      .set({
        ...values,
        ...(opts.secret ? { secretCiphertext: encryptSecret(opts.secret) } : {}),
      })
      .where(eq(provisioningCredentials.id, opts.id));
  } else {
    await db.insert(provisioningCredentials).values({
      subscriptionId: opts.subscriptionId,
      ...values,
      secretCiphertext: opts.secret ? encryptSecret(opts.secret) : null,
      createdByUserId: opts.actorUserId,
    });
  }
  await writeAudit({
    tenantId: await subscriptionTenant(opts.subscriptionId),
    subscriptionId: opts.subscriptionId,
    actorUserId: opts.actorUserId,
    kind: opts.id ? "credential_updated" : "credential_added",
    payload: { kind: opts.kind, label: opts.label },
  });
}

export async function deleteCredential(credentialId: string, actorUserId: string): Promise<void> {
  const cred = await db.query.provisioningCredentials.findFirst({
    where: eq(provisioningCredentials.id, credentialId),
  });
  if (!cred) return;
  await db.delete(provisioningCredentials).where(eq(provisioningCredentials.id, credentialId));
  await writeAudit({
    tenantId: await subscriptionTenant(cred.subscriptionId),
    subscriptionId: cred.subscriptionId,
    actorUserId,
    kind: "credential_deleted",
    payload: { kind: cred.kind, label: cred.label },
  });
}

/** Reveal is the ONLY decrypt path, and every use is audited (PRD §4.7). */
export async function revealCredentialSecret(
  credentialId: string,
  actorUserId: string,
): Promise<string> {
  const cred = await db.query.provisioningCredentials.findFirst({
    where: eq(provisioningCredentials.id, credentialId),
  });
  if (!cred?.secretCiphertext) throw new Error("No secret stored");
  await writeAudit({
    tenantId: await subscriptionTenant(cred.subscriptionId),
    subscriptionId: cred.subscriptionId,
    actorUserId,
    kind: "credential_revealed",
    payload: { kind: cred.kind, label: cred.label },
  });
  return decryptSecret(cred.secretCiphertext);
}
