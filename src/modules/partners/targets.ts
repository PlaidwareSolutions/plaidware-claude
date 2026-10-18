import { eq } from "drizzle-orm";
import { db } from "../../db";
import { env } from "../../env";
import { decryptSecret } from "../../lib/crypto";
import { slugMatchesPrefixes } from "./logic";
import { partnerApps } from "./schema";

/**
 * Where a partner-scoped webhook goes. MHub predates partner_apps and keeps
 * its env configuration (MHUB_*) and its exact payloads; every other app is
 * a partner_apps row whose payloads also carry `external_tenant_id` and
 * `billing_status` (docs/PARTNER-API.md).
 */
export type PartnerTarget = {
  /** Null = the built-in, env-configured MHub. */
  appId: string | null;
  name: string;
  displayName: string;
  prefixes: string[];
  lifecycleUrl: string | null;
  provisionUrl: string | null;
  secret: string | null;
  receivesMembership: boolean;
  extendedPayloads: boolean;
};

type PartnerAppRow = typeof partnerApps.$inferSelect;

export const MHUB_PREFIX = "marketing-";

export function mhubTarget(): PartnerTarget {
  return {
    appId: null,
    name: "mhub",
    displayName: "MHub",
    prefixes: [MHUB_PREFIX],
    lifecycleUrl: env.MHUB_LIFECYCLE_URL ?? null,
    provisionUrl: env.MHUB_BASE_URL
      ? `${env.MHUB_BASE_URL.replace(/\/+$/, "")}/api/hub/provision`
      : null,
    secret: env.MHUB_WEBHOOK_SECRET ?? null,
    receivesMembership: true,
    extendedPayloads: false,
  };
}

function openSecret(sealed: string | null): string | null {
  if (!sealed) return null;
  try {
    return decryptSecret(sealed);
  } catch (e) {
    console.error("[partners] webhook secret could not be decrypted:", e);
    return null;
  }
}

export function targetForApp(app: PartnerAppRow): PartnerTarget {
  return {
    appId: app.id,
    name: app.name,
    displayName: app.displayName,
    prefixes: app.productPrefixes,
    lifecycleUrl: app.webhookUrl,
    provisionUrl: app.provisionUrl ?? app.webhookUrl,
    secret: openSecret(app.webhookSecretEnc),
    receivesMembership: app.receivesMembership,
    extendedPayloads: true,
  };
}

/** Lifecycle + provision URLs and a secret are all present. */
export function targetConfigured(t: PartnerTarget, kind: "lifecycle" | "provision"): boolean {
  return Boolean(t.secret && (kind === "provision" ? t.provisionUrl : t.lifecycleUrl));
}

/** Every webhook target: MHub first, then active partner apps. */
export async function listPartnerTargets(): Promise<PartnerTarget[]> {
  const apps = await db.query.partnerApps.findMany({ where: eq(partnerApps.status, "active") });
  return [mhubTarget(), ...apps.map(targetForApp)];
}

/** The partner that owns a product slug, or null for Hub-only products. */
export async function partnerForSlug(slug: string): Promise<PartnerTarget | null> {
  if (slug.startsWith(MHUB_PREFIX)) return mhubTarget();
  const apps = await db.query.partnerApps.findMany({ where: eq(partnerApps.status, "active") });
  const app = apps.find((a) => slugMatchesPrefixes(a.productPrefixes, slug));
  return app ? targetForApp(app) : null;
}

/** The target an outbox row was queued for (null appId = MHub). */
export async function targetForDelivery(appId: string | null): Promise<PartnerTarget | null> {
  if (!appId) return mhubTarget();
  const app = await db.query.partnerApps.findFirst({ where: eq(partnerApps.id, appId) });
  return app && app.status === "active" ? targetForApp(app) : null;
}

/** Which partner app (if any) runs a product, by slug. */
export type PartnerDirectory = (slug: string) => { name: string; displayName: string } | null;

/**
 * One read of partner_apps for a page's worth of slug checks (badges,
 * locked slugs, no-DNS provisioning). Disabled apps still own their slugs —
 * the contract with the partner outlives a paused integration.
 */
export async function loadPartnerDirectory(): Promise<PartnerDirectory> {
  const apps = await db.query.partnerApps.findMany();
  return (slug) => {
    if (slug.startsWith(MHUB_PREFIX)) return { name: "mhub", displayName: "MHub" };
    const app = apps.find((a) => slugMatchesPrefixes(a.productPrefixes, slug));
    return app ? { name: app.name, displayName: app.displayName } : null;
  };
}
