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

  it("labels roles from the role table", () => {
    expect(statusVariant("platformRole", "ops_admin")).toEqual({ variant: "default", label: "ops admin" });
    expect(statusVariant("platformRole", "ops_support")).toEqual({ variant: "outline", label: "ops support" });
    expect(statusVariant("platformRole", "customer").variant).toBe("secondary");
    expect(statusVariant("platformRole", "developer")).toEqual({ variant: "success", label: "developer" });
    expect(statusVariant("tenantRole", "owner")).toEqual({ variant: "secondary", label: "owner" });
    expect(statusVariant("tenantRole", "billing").label).toBe("billing");
    expect(statusVariant("roleRequest", "pending").variant).toBe("warning");
    expect(statusVariant("roleRequest", "denied").label).toBe("declined");
    expect(statusVariant("accountStatus", "disabled").variant).toBe("destructive");
    expect(statusVariant("session", "current")).toEqual({ variant: "success", label: "this device" });
  });

  it("covers the work area", () => {
    expect(statusVariant("workItem", "in_progress")).toEqual({ variant: "default", label: "in progress" });
    expect(statusVariant("workItem", "done").variant).toBe("success");
    expect(statusVariant("workType", "bug").variant).toBe("destructive");
    expect(statusVariant("workPriority", "urgent").variant).toBe("destructive");
    expect(statusVariant("sprint", "active").variant).toBe("success");
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
