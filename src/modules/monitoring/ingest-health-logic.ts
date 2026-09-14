/** Pure roll-up of metric_ingest_events for the Monitoring board. */

export type IngestEventLike = {
  subscriptionId: string;
  ok: boolean;
  statusCode: number;
  errorMessage: string | null;
  unknownKeys: string[];
  createdAt: Date | string;
};

export type IngestHealth = {
  subscriptionId: string;
  calls: number;
  errors: number;
  lastAt: string | null;
  lastError: string | null;
  /** Distinct keys posted that no KPI defines — a product-contract gap. */
  unknownKeys: string[];
};

export function summarizeIngestEvents(events: IngestEventLike[]): IngestHealth[] {
  const by = new Map<string, IngestHealth & { lastTs: number; lastErrTs: number }>();
  for (const e of events) {
    const ts = new Date(e.createdAt).getTime();
    const cur = by.get(e.subscriptionId) ?? {
      subscriptionId: e.subscriptionId,
      calls: 0,
      errors: 0,
      lastAt: null,
      lastError: null,
      unknownKeys: [],
      lastTs: 0,
      lastErrTs: 0,
    };
    cur.calls++;
    if (!e.ok) {
      cur.errors++;
      if (ts >= cur.lastErrTs) {
        cur.lastErrTs = ts;
        cur.lastError = e.errorMessage ?? `HTTP ${e.statusCode}`;
      }
    }
    if (ts >= cur.lastTs) {
      cur.lastTs = ts;
      cur.lastAt = new Date(ts).toISOString();
    }
    for (const k of e.unknownKeys) if (!cur.unknownKeys.includes(k)) cur.unknownKeys.push(k);
    by.set(e.subscriptionId, cur);
  }
  return [...by.values()]
    .map(({ lastTs: _a, lastErrTs: _b, ...rest }) => ({ ...rest, unknownKeys: rest.unknownKeys.sort() }))
    .sort((a, b) => b.errors - a.errors || b.unknownKeys.length - a.unknownKeys.length || b.calls - a.calls);
}
