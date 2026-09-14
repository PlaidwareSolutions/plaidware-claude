import { describe, expect, it } from "vitest";
import { collectionKey, statusVariant } from "./status-variants";

describe("status variants", () => {
  it("maps the statuses that used to disagree across pages", () => {
    expect(statusVariant("subscription", "active").variant).toBe("success");
    expect(statusVariant("subscription", "past_due")).toEqual({ variant: "warning", label: "past due" });
    expect(statusVariant("subscription", "canceled").variant).toBe("outline");
    expect(statusVariant("invoice", "void").variant).toBe("outline");
    expect(statusVariant("invoice", "failed").variant).toBe("destructive");
    expect(statusVariant("tenant", "suspended").variant).toBe("destructive");
  });

  it("falls back gracefully for unknown or missing statuses", () => {
    expect(statusVariant("health", null)).toEqual({ variant: "outline", label: "no data" });
    expect(statusVariant("webhook", "weird_state")).toEqual({ variant: "outline", label: "weird state" });
  });

  it("derives the collection key from Stripe automation state", () => {
    expect(collectionKey({ collectionMethod: "charge_automatically", cardOnFile: true, error: null })).toBe("auto_charge");
    expect(collectionKey({ collectionMethod: "charge_automatically", cardOnFile: false, error: null })).toBe("auto_charge_no_card");
    expect(collectionKey({ collectionMethod: "send_invoice", cardOnFile: true, error: null })).toBe("send_invoice_card");
    expect(collectionKey({ collectionMethod: "send_invoice", cardOnFile: false, error: null })).toBe("send_invoice_no_card");
    expect(collectionKey({ collectionMethod: "send_invoice", cardOnFile: false, error: "Stripe down" })).toBe("unknown");
    expect(collectionKey(undefined)).toBe("unknown");
    expect(statusVariant("collection", "send_invoice_no_card").label).toBe("emailed invoice · no card");
  });
});
