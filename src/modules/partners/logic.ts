import { createHash } from "node:crypto";

/** How long a Partner API Idempotency-Key is remembered. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Same algorithm as ingest keys: the whole raw key, SHA-256, hex. */
export function hashPartnerKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * A key may read `requestedPrefix` when some allowlist entry equals it or is
 * a prefix of it — a narrower request than the grant is always fine, a
 * broader one never is.
 */
export function partnerKeyAllows(allowlist: string[], requestedPrefix: string): boolean {
  if (!requestedPrefix) return false;
  return allowlist.some((granted) => granted.length > 0 && requestedPrefix.startsWith(granted));
}

/** True when `slug` belongs to an app owning `prefixes` (same rule as the key allowlist). */
export function slugMatchesPrefixes(prefixes: string[], slug: string): boolean {
  return partnerKeyAllows(prefixes, slug);
}

/**
 * The one access-relevant state a partner app mirrors (docs/PARTNER-API.md
 * "billing_status"). `null` = the tenant has no subscription to the app's
 * products; Hub's `incomplete` (first payment not made) reads as `pending`.
 */
export type PartnerBillingStatus =
  | "none"
  | "pending"
  | "trialing"
  | "active"
  | "past_due"
  | "suspended"
  | "canceled"
  | "expired";

export function billingStatusFor(
  subscriptionStatus: string | null | undefined,
  workspaceStatus?: string | null,
): PartnerBillingStatus {
  const base = subscriptionBillingStatus(subscriptionStatus);
  // A Hub workspace hold (ops suspended or deactivated the client) overrides
  // a live subscription: the partner sees one access-relevant value.
  const held = workspaceStatus === "suspended" || workspaceStatus === "inactive";
  return held && (base === "trialing" || base === "active" || base === "past_due") ? "suspended" : base;
}

/**
 * "standard" = the catalog price; "custom" = a negotiated price for this
 * client (a tenant price override on the plan's base charge — what ops set
 * for a multi-store shop). Partners key plan rules (e.g. a store cap) on it.
 */
export type PartnerPlanKey = "standard" | "custom";
export function planKeyFor(hasBaseOverride: boolean): PartnerPlanKey {
  return hasBaseOverride ? "custom" : "standard";
}

function subscriptionBillingStatus(subscriptionStatus: string | null | undefined): PartnerBillingStatus {
  switch (subscriptionStatus) {
    case null:
    case undefined:
      return "none";
    case "incomplete":
      return "pending";
    case "trialing":
    case "active":
    case "past_due":
    case "suspended":
    case "canceled":
    case "expired":
      return subscriptionStatus;
    default:
      return "none";
  }
}

/**
 * A redirect URL a partner hands us (checkout success/cancel, portal return)
 * must be on one of the app's registered origins — otherwise a leaked key
 * could turn Hub-minted Stripe links into an open redirect.
 */
export function isAllowedReturnUrl(url: string, allowedOrigins: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (parsed.username || parsed.password) return false;
  return allowedOrigins.some((o) => {
    try {
      return new URL(o).origin === parsed.origin;
    } catch {
      return false;
    }
  });
}

/** The partner-side user a mutation is made on behalf of (X-Partner-Actor). */
export type PartnerActor = {
  externalUserId: string;
  email: string;
  name: string;
  role: string;
};

/** Parse the X-Partner-Actor JSON header; null when absent or malformed. */
export function parsePartnerActor(header: string | null): PartnerActor | null {
  if (!header) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(header);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null;
  const externalUserId = str(r.external_user_id, 200);
  const email = str(r.email, 320);
  if (!externalUserId || !email || !email.includes("@")) return null;
  return {
    externalUserId,
    email: email.toLowerCase(),
    name: str(r.name, 200) ?? "",
    role: str(r.role, 50) ?? "",
  };
}

/** Audit actor label for a partner-originated change: `partner:<app>/<email>`. */
export function partnerActorLabel(appName: string, actor: PartnerActor | null): string {
  return actor ? `partner:${appName}/${actor.email}` : `partner:${appName}`;
}

/** A requested add-on state from the Partner API: the quantity the partner wants. */
export type ItemChange = { componentId: string; quantity: number };

export type ItemChangePlan = {
  addItems: { componentId: string; quantity: number }[];
  setQuantities: { itemId: string; quantity: number }[];
};

/**
 * Turn "make Extra Terminal quantity 3" into the add / set-quantity calls
 * billing.changeSubscriptionItems understands. Recurring add-ons are set to
 * the exact quantity (0 removes); a one-time add-on with quantity > 0 is a
 * purchase made now. The base charge and unknown components are refused.
 */
export function planItemChanges(
  current: { id: string; componentId: string | null; kind: string; status: string }[],
  addons: { componentId: string; kind: string }[],
  changes: ItemChange[],
): ItemChangePlan | { error: string } {
  const plan: ItemChangePlan = { addItems: [], setQuantities: [] };
  const seen = new Set<string>();
  for (const ch of changes) {
    if (seen.has(ch.componentId)) return { error: "Each component may appear only once" };
    seen.add(ch.componentId);
    if (!Number.isInteger(ch.quantity) || ch.quantity < 0 || ch.quantity > 999) {
      return { error: "Quantity must be a whole number from 0 to 999" };
    }
    const addon = addons.find((a) => a.componentId === ch.componentId);
    if (!addon) return { error: "That component isn't an add-on of this product" };
    if (addon.kind === "one_time") {
      if (ch.quantity > 0) plan.addItems.push({ componentId: ch.componentId, quantity: ch.quantity });
      continue;
    }
    const live = current.find((i) => i.componentId === ch.componentId && i.status === "active");
    if (live) plan.setQuantities.push({ itemId: live.id, quantity: ch.quantity });
    else if (ch.quantity > 0) plan.addItems.push({ componentId: ch.componentId, quantity: ch.quantity });
  }
  return plan;
}

/**
 * Validate a partner app's product prefixes against the others: slug-safe,
 * never MHub's `marketing-` space, and no overlap (either way round) with
 * another app — one product slug belongs to at most one partner.
 */
export function prefixProblem(
  prefixes: string[],
  others: { name: string; prefixes: string[] }[],
): string | null {
  if (prefixes.length === 0) return "Add at least one product-slug prefix";
  for (const p of prefixes) {
    if (!/^[a-z0-9-]{2,64}$/.test(p)) return `"${p}" must be 2–64 lowercase letters, digits or dashes`;
    if (p.startsWith("marketing") || "marketing-".startsWith(p)) return `"${p}" overlaps MHub's marketing-* products`;
    for (const o of others) {
      const clash = o.prefixes.find((q) => q.startsWith(p) || p.startsWith(q));
      if (clash) return `"${p}" overlaps ${o.name}'s prefix "${clash}"`;
    }
  }
  return null;
}

/** Normalise a return origin: https anywhere, http only for localhost. */
export function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
    return u.origin;
  } catch {
    return null;
  }
}
