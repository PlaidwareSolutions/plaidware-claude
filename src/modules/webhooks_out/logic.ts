import { createHmac } from "node:crypto";

/**
 * Pure logic for the MHub integration contract (§B/§C): scope filter,
 * signature scheme, and the retry state machine. DB and network live in
 * service.ts; everything here is unit-tested.
 */

/** Hub knows zero marketing concepts — only this slug prefix (contract §B). */
export function isMarketingSlug(slug: string): boolean {
  return slug.startsWith("marketing-");
}

/** Contract §B: retry 1m, 5m, 30m, 2h, 12h after the initial attempt, then dead-letter. */
export const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  12 * 60 * 60_000,
] as const;

/** `sha256=` + hex HMAC-SHA256 of `${timestamp}.${rawBody}` (contract §B). */
export function signWebhookPayload(
  secret: string,
  timestampSeconds: number,
  rawBody: string,
): string {
  return (
    "sha256=" +
    createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex")
  );
}

export function buildDeliveryHeaders(opts: {
  event: string;
  deliveryId: string;
  timestampSeconds: number;
  signature: string;
}): Record<string, string> {
  return {
    "content-type": "application/json",
    "X-Plaidware-Event": opts.event,
    "X-Plaidware-Delivery": opts.deliveryId,
    "X-Plaidware-Timestamp": String(opts.timestampSeconds),
    "X-Plaidware-Signature": opts.signature,
  };
}

export type LifecycleEvent =
  | "subscription.activated"
  | "subscription.updated"
  | "subscription.past_due"
  | "subscription.suspended"
  | "subscription.canceled"
  | "subscription.expired";

/**
 * Contract §B event for a subscription status transition, or null when MHub
 * doesn't care (entering incomplete, no-op transitions). Data-only changes
 * (period end moved, add-ons changed) are the caller's explicit
 * "subscription.updated".
 */
export function subscriptionEventForStatusChange(
  prev: string,
  next: string,
): LifecycleEvent | null {
  if (prev === next) return null;
  const wasLive = prev === "active" || prev === "trialing";
  switch (next) {
    case "active":
    case "trialing":
      // Trials are live from MHub's perspective; the payload carries the
      // literal status so MHub can distinguish.
      return wasLive ? "subscription.updated" : "subscription.activated";
    case "past_due":
      return "subscription.past_due";
    case "suspended":
      return "subscription.suspended";
    case "canceled":
      return "subscription.canceled";
    case "expired":
      return "subscription.expired";
    default:
      return null; // incomplete or unknown — nothing to tell MHub
  }
}

export type AttemptOutcome =
  | { ok: true }
  | { ok: false; permanent: boolean; error: string };

export type AttemptPatch = {
  status: "delivered" | "pending" | "dead" | "disabled";
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt?: Date;
  deliveredAt?: Date;
};

/**
 * Retry state machine: outcome of one attempt → row patch. `permanent` is a
 * 410 from MHub (contract §B: disable that delivery). Retries exhaust after
 * RETRY_DELAYS_MS is consumed → dead-letter.
 */
export function applyAttemptOutcome(
  row: { attemptCount: number },
  outcome: AttemptOutcome,
  now: Date,
): AttemptPatch {
  const attemptCount = row.attemptCount + 1;
  if (outcome.ok) {
    return { status: "delivered", attemptCount, lastError: null, deliveredAt: now };
  }
  if (outcome.permanent) {
    return { status: "disabled", attemptCount, lastError: outcome.error };
  }
  const delay = RETRY_DELAYS_MS[attemptCount - 1];
  if (delay === undefined) {
    return { status: "dead", attemptCount, lastError: outcome.error };
  }
  return {
    status: "pending",
    attemptCount,
    lastError: outcome.error,
    nextAttemptAt: new Date(now.getTime() + delay),
  };
}
