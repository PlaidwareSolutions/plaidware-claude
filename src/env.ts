import { z } from "zod";

/**
 * Server-side environment, validated at first import so a misconfigured
 * deploy fails at boot, not at 2am when the first request needs the value.
 * Never import this from a client component.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().startsWith("postgres"),
  BETTER_AUTH_SECRET: z.string().min(32),
  APP_BASE_URL: z.string().startsWith("http"),
  /** Extra origins allowed to call the auth API (comma-separated), e.g. the *.up.railway.app URL alongside the custom domain. */
  TRUSTED_ORIGINS: z.string().optional(),
  RESEND_API_KEY: z.string().startsWith("re_").optional(),
  EMAIL_FROM: z.string().default("Plaidware <no-reply@contact.plaidware.com>"),
  OPS_EMAIL: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(40).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("\n  ");
  throw new Error(`Invalid environment:\n  ${missing}`);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
