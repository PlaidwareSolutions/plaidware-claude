import { z } from "zod";
import { isPlaceholderPhone, normalizePhone } from "@/lib/phone";

export const PHONE_MESSAGE = "Enter a phone number with a country code, e.g. +1 555 123 4567";

/** Self-service profile edit: names trimmed, phone normalised server-side, the placeholder refused. */
export const profileSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().min(1, "Last name is required").max(60),
  phone: z.string().transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n || isPlaceholderPhone(n)) {
      ctx.addIssue({ code: "custom", message: PHONE_MESSAGE });
      return z.NEVER;
    }
    return n;
  }),
});
export type ProfileInput = z.input<typeof profileSchema>;

export const emailChangeSchema = z.object({
  newEmail: z.email("Enter a valid email address").transform((s) => s.trim().toLowerCase()),
});
