import { describe, expect, it } from "vitest";
import { paymentMethod } from "./ar-schema";
import { OFFLINE_PAYMENT_METHODS, PAYMENT_METHODS, isOfflinePaymentMethod } from "./payment-methods";

describe("payment methods", () => {
  it("mirrors the payment_method pg enum exactly", () => {
    expect([...paymentMethod.enumValues]).toEqual([...PAYMENT_METHODS]);
  });
  it("offline methods are a subset that excludes Stripe-collected ones", () => {
    for (const m of OFFLINE_PAYMENT_METHODS) expect(PAYMENT_METHODS).toContain(m);
    expect(isOfflinePaymentMethod("cash")).toBe(true);
    expect(isOfflinePaymentMethod("stripe_card")).toBe(false);
  });
});
