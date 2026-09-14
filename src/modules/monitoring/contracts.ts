import { z } from "zod";

/** Metric keys the ingest endpoint interprets as health, never as a KPI. */
export const RESERVED_KEYS = ["status", "response_time_ms"] as const;

export const AGGREGATIONS = ["sum", "avg", "last", "max"] as const;
export const DIRECTIONS = ["up_is_good", "down_is_good"] as const;
export const VALUE_TYPES = ["count", "duration_seconds", "currency_cents", "percent", "gauge"] as const;

export const metricDefinitionSchema = z.object({
  id: z.string().uuid().optional(),
  productId: z.string().uuid(),
  key: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "Keys are snake_case: letters, digits, underscores")
    .refine((k) => !(RESERVED_KEYS as readonly string[]).includes(k), {
      message: `Reserved for health reporting: ${RESERVED_KEYS.join(", ")}`,
    }),
  label: z.string().trim().min(1).max(80),
  unit: z.string().trim().max(20).optional().nullable(),
  valueType: z.enum(VALUE_TYPES).default("count"),
  aggregation: z.enum(AGGREGATIONS).default("sum"),
  direction: z.enum(DIRECTIONS).default("up_is_good"),
  target: z.number().finite().optional().nullable(),
  isPrimary: z.boolean().default(false),
});

export type MetricDefinitionInput = z.input<typeof metricDefinitionSchema>;
