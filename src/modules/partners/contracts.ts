import { z } from "zod";

/** Partner API v1 request bodies (docs/PARTNER-API.md). snake_case on the wire. */

const externalId = z.string().trim().min(1).max(200);
const url = z.string().trim().url().max(2000);

export const startTenantSchema = z.object({
  external_tenant_id: externalId,
  name: z.string().trim().min(1).max(200),
  owner: z.object({
    email: z.string().trim().toLowerCase().email().max(320),
    name: z.string().trim().max(200).default(""),
  }),
  product_slug: z.string().trim().max(100).optional(),
  success_url: url,
  cancel_url: url.optional(),
});

export const checkoutSchema = z.object({
  product_slug: z.string().trim().max(100).optional(),
  success_url: url,
  cancel_url: url.optional(),
});

export const portalSchema = z.object({ return_url: url });

export const itemsSchema = z.object({
  changes: z
    .array(z.object({ component_id: z.string().uuid(), quantity: z.number().int().min(0).max(999) }))
    .min(1)
    .max(20),
});

export const cancelSchema = z.object({
  at_period_end: z.boolean().default(true),
  reason: z.string().trim().max(500).optional(),
});

export const invoicesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    billing_email: z.string().trim().toLowerCase().email().max(320).optional(),
    billing_name: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.name !== undefined || v.billing_email !== undefined || v.billing_name !== undefined, {
    message: "Send at least one of name, billing_email, billing_name",
  });

/** POST /work-items — a report from the partner's users, filed as a ticket on the app's product board. */
export const createWorkItemSchema = z.object({
  /** The partner's own report id; the same ref always lands on the same ticket. */
  external_ref: externalId,
  kind: z.enum(["bug", "feedback", "idea"]),
  title: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1).max(10000),
  /** The shop it came from: the ticket's requester (ops-only) when that tenant is linked, else ignored. */
  external_tenant_id: externalId.nullish(),
  page: z
    .object({ path: z.string().trim().max(500).nullish(), name: z.string().trim().max(200).nullish() })
    .nullish(),
  user_agent: z.string().trim().max(500).nullish(),
  viewport: z.object({ width: z.number().int().positive().max(20000), height: z.number().int().positive().max(20000) }).nullish(),
  /** Where staff can open the report in the partner app. */
  report_url: url.nullish(),
  /** PNG/JPEG/GIF/WebP, up to 5 MB once decoded. */
  screenshot: z
    .object({ data_base64: z.string().max(7_000_000), file_name: z.string().trim().max(200).nullish() })
    .nullish(),
});
export type CreateWorkItemBody = z.output<typeof createWorkItemSchema>;
