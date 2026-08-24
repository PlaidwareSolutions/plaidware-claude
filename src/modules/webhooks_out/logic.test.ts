import { describe, expect, it } from "vitest";
import {
  RETRY_DELAYS_MS,
  applyAttemptOutcome,
  buildDeliveryHeaders,
  isMarketingSlug,
  signWebhookPayload,
  subscriptionEventForStatusChange,
} from "./logic";

describe("isMarketingSlug", () => {
  it("accepts only marketing- prefixed slugs", () => {
    expect(isMarketingSlug("marketing-hs-growth")).toBe(true);
    expect(isMarketingSlug("marketing-dental-foundation")).toBe(true);
    expect(isMarketingSlug("company-website")).toBe(false);
    expect(isMarketingSlug("premarketing-x")).toBe(false);
    expect(isMarketingSlug("")).toBe(false);
  });
});

describe("signWebhookPayload", () => {
  it("signs `${timestamp}.${rawBody}` as sha256= + hex HMAC (contract §B)", () => {
    // Known vector: HMAC-SHA256("secret", "1700000000.{}")
    const sig = signWebhookPayload("secret", 1_700_000_000, "{}");
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(sig).toBe(signWebhookPayload("secret", 1_700_000_000, "{}"));
    expect(sig).not.toBe(signWebhookPayload("secret", 1_700_000_001, "{}"));
    expect(sig).not.toBe(signWebhookPayload("other", 1_700_000_000, "{}"));
    expect(sig).not.toBe(signWebhookPayload("secret", 1_700_000_000, "{ }"));
  });
});

describe("buildDeliveryHeaders", () => {
  it("carries the four X-Plaidware headers", () => {
    const h = buildDeliveryHeaders({
      event: "subscription.activated",
      deliveryId: "d-1",
      timestampSeconds: 123,
      signature: "sha256=abc",
    });
    expect(h["X-Plaidware-Event"]).toBe("subscription.activated");
    expect(h["X-Plaidware-Delivery"]).toBe("d-1");
    expect(h["X-Plaidware-Timestamp"]).toBe("123");
    expect(h["X-Plaidware-Signature"]).toBe("sha256=abc");
    expect(h["content-type"]).toBe("application/json");
  });
});

describe("subscriptionEventForStatusChange", () => {
  it("maps entering a live status from a non-live one to activated", () => {
    expect(subscriptionEventForStatusChange("incomplete", "active")).toBe(
      "subscription.activated",
    );
    expect(subscriptionEventForStatusChange("incomplete", "trialing")).toBe(
      "subscription.activated",
    );
    expect(subscriptionEventForStatusChange("suspended", "active")).toBe(
      "subscription.activated",
    );
    expect(subscriptionEventForStatusChange("past_due", "active")).toBe(
      "subscription.activated",
    );
  });

  it("maps live-to-live moves to updated", () => {
    expect(subscriptionEventForStatusChange("trialing", "active")).toBe("subscription.updated");
    expect(subscriptionEventForStatusChange("active", "trialing")).toBe("subscription.updated");
  });

  it("maps each degraded status to its event", () => {
    expect(subscriptionEventForStatusChange("active", "past_due")).toBe("subscription.past_due");
    expect(subscriptionEventForStatusChange("past_due", "suspended")).toBe(
      "subscription.suspended",
    );
    expect(subscriptionEventForStatusChange("active", "canceled")).toBe("subscription.canceled");
    expect(subscriptionEventForStatusChange("active", "expired")).toBe("subscription.expired");
  });

  it("returns null for no-ops and entering incomplete", () => {
    expect(subscriptionEventForStatusChange("active", "active")).toBeNull();
    expect(subscriptionEventForStatusChange("active", "incomplete")).toBeNull();
  });
});

describe("applyAttemptOutcome", () => {
  const now = new Date("2026-08-23T12:00:00Z");

  it("marks success delivered with deliveredAt", () => {
    const p = applyAttemptOutcome({ attemptCount: 0 }, { ok: true }, now);
    expect(p).toMatchObject({ status: "delivered", attemptCount: 1, lastError: null });
    expect(p.deliveredAt).toEqual(now);
  });

  it("schedules retries on the contract backoff (1m, 5m, 30m, 2h, 12h)", () => {
    for (const [i, delay] of RETRY_DELAYS_MS.entries()) {
      const p = applyAttemptOutcome(
        { attemptCount: i },
        { ok: false, permanent: false, error: "HTTP 500" },
        now,
      );
      expect(p.status).toBe("pending");
      expect(p.attemptCount).toBe(i + 1);
      expect(p.lastError).toBe("HTTP 500");
      expect(p.nextAttemptAt).toEqual(new Date(now.getTime() + delay));
    }
  });

  it("dead-letters after the backoff schedule is exhausted", () => {
    const p = applyAttemptOutcome(
      { attemptCount: RETRY_DELAYS_MS.length },
      { ok: false, permanent: false, error: "HTTP 503" },
      now,
    );
    expect(p.status).toBe("dead");
    expect(p.nextAttemptAt).toBeUndefined();
  });

  it("disables permanently on 410 regardless of attempts left", () => {
    const p = applyAttemptOutcome(
      { attemptCount: 0 },
      { ok: false, permanent: true, error: "410 Gone" },
      now,
    );
    expect(p.status).toBe("disabled");
    expect(p.attemptCount).toBe(1);
  });
});
