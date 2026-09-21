import { z } from "zod";
import { OFFLINE_PAYMENT_METHODS } from "./payment-methods";

/**
 * Zod contracts shared by the billing server actions (a "use server" module
 * may only export async functions, so schemas live here).
 */

export const offlinePaymentDetailsSchema = z.object({
  method: z.enum(OFFLINE_PAYMENT_METHODS),
  reference: z.string().max(120).optional(),
  /** ISO instant; absent = now. */
  receivedAt: z.string().optional(),
  note: z.string().max(300).optional(),
  sendReceipt: z.boolean().default(true),
});
export type OfflinePaymentDetailsInput = z.input<typeof offlinePaymentDetailsSchema>;

export const startSettlementSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("invoice") }),
  z.object({ mode: z.literal("waive") }),
  z.object({ mode: z.literal("offline"), payment: offlinePaymentDetailsSchema }),
]);

export const startItemSchema = z.object({
  componentId: z.string().uuid(),
  /** Unit price in cents. */
  amountCents: z.number().int().min(0).max(100_000_000),
  quantity: z.number().int().min(1).max(999).default(1),
  /** One-time components only. */
  settlement: startSettlementSchema.optional(),
});

export const billFromMonthSchema = z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM");

export const startSubscriptionSchema = z.object({
  tenantId: z.string().min(1),
  productId: z.string().uuid(),
  items: z.array(startItemSchema).min(1).max(30),
  collection: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("send_invoice"), daysUntilDue: z.number().int().min(1).max(90).default(14) }),
    z.object({ mode: z.literal("charge_card_now") }),
  ]),
  /** Bill calendar months from here; the catch-up rides the first invoice. */
  billFromMonth: billFromMonthSchema.optional(),
  skipTrial: z.boolean().default(true),
  /** Save the negotiated prices as the client's custom pricing. */
  persistOverrides: z.boolean().default(true),
});
export type StartSubscriptionInput = z.input<typeof startSubscriptionSchema>;
