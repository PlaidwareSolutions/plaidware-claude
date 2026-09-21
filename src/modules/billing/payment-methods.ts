/**
 * Payment methods the ledger knows. Pure module — safe for client components
 * and tests; the `payment_method` pg enum in ar-schema.ts must list the same
 * values (asserted by payment-methods.test.ts).
 */
export const PAYMENT_METHODS = ["stripe_card", "stripe_ach", "cash", "check", "zelle", "wire", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Methods ops record by hand — everything Stripe didn't collect. */
export const OFFLINE_PAYMENT_METHODS = ["cash", "check", "zelle", "wire", "other"] as const;
export type OfflinePaymentMethod = (typeof OFFLINE_PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  stripe_card: "Card (Stripe)",
  stripe_ach: "Bank debit (Stripe)",
  cash: "Cash",
  check: "Check",
  zelle: "Zelle",
  wire: "Wire",
  other: "Other",
};

export function isOfflinePaymentMethod(m: string): m is OfflinePaymentMethod {
  return (OFFLINE_PAYMENT_METHODS as readonly string[]).includes(m);
}

/** What ops types when money arrived outside Stripe. `receivedAt` is ISO; absent = now. */
export type OfflinePaymentDetails = {
  method: OfflinePaymentMethod;
  reference?: string;
  receivedAt?: string;
  note?: string;
  /** Email the client a "Payment received" receipt (default true). */
  sendReceipt?: boolean;
};
