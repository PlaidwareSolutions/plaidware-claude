/** Pure ingest partitioning — the reserved-key contract from the legacy app. */

export const RESERVED_KEYS = new Set([
  "status",
  "response_time_ms",
  "error_rate",
  "error_rate_percent",
  "uptime_percent",
  "uptime_percentage",
]);

export type IngestEvent = {
  metric: string;
  quantity?: number;
  unit?: string;
  metadata?: Record<string, unknown>;
};

export type Partitioned = {
  health: {
    status: string;
    responseTimeMs: number | null;
  } | null;
  business: { metric: string; quantity: number; unit: string | null }[];
  unknownKeys: string[];
};

export function inferUnit(metric: string, provided?: string): string | null {
  if (provided) return provided;
  if (metric.endsWith("_ms")) return "ms";
  if (metric.endsWith("_seconds")) return "s";
  if (metric.endsWith("_mb")) return "mb";
  return null;
}

/** Split a payload into a reporter health row, business records, and drift. */
export function partitionEvents(events: IngestEvent[], knownKeys: Set<string>): Partitioned {
  const reserved = events.filter((e) => RESERVED_KEYS.has(e.metric));
  const business = events.filter((e) => !RESERVED_KEYS.has(e.metric));

  let health: Partitioned["health"] = null;
  if (reserved.length > 0) {
    const statusEvent = reserved.find((e) => e.metric === "status");
    const rt = reserved.find((e) => e.metric === "response_time_ms");
    health = {
      status:
        typeof statusEvent?.metadata?.value === "string"
          ? statusEvent.metadata.value
          : "healthy",
      responseTimeMs: rt?.quantity != null ? Math.round(rt.quantity) : null,
    };
  }

  const unknownKeys = [
    ...new Set(business.filter((e) => !knownKeys.has(e.metric)).map((e) => e.metric)),
  ];

  return {
    health,
    business: business
      .filter((e) => typeof e.quantity === "number" && Number.isFinite(e.quantity))
      .map((e) => ({
        metric: e.metric,
        quantity: e.quantity!,
        unit: inferUnit(e.metric, e.unit),
      })),
    unknownKeys,
  };
}
