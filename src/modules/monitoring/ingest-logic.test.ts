import { describe, expect, it } from "vitest";
import { inferUnit, partitionEvents } from "./ingest-logic";

const known = new Set(["page_views", "leads_submitted", "avg_session_seconds"]);

describe("partitionEvents", () => {
  it("routes reserved keys to a health row and business keys to records", () => {
    const p = partitionEvents(
      [
        { metric: "status", metadata: { value: "degraded" } },
        { metric: "response_time_ms", quantity: 142.6 },
        { metric: "page_views", quantity: 250 },
        { metric: "avg_session_seconds", quantity: 61.5 },
      ],
      known,
    );
    expect(p.health).toEqual({ status: "degraded", responseTimeMs: 143 });
    expect(p.business).toHaveLength(2);
    expect(p.unknownKeys).toEqual([]);
  });

  it("flags unknown business keys without dropping them", () => {
    const p = partitionEvents(
      [
        { metric: "page_views", quantity: 10 },
        { metric: "wizard_completions", quantity: 3 },
        { metric: "wizard_completions", quantity: 4 },
      ],
      known,
    );
    expect(p.unknownKeys).toEqual(["wizard_completions"]);
    expect(p.business).toHaveLength(3); // unknown still recorded (dedup only in flags)
  });

  it("no reserved keys → no health row; defaults status healthy when present", () => {
    expect(partitionEvents([{ metric: "page_views", quantity: 1 }], known).health).toBeNull();
    const p = partitionEvents([{ metric: "response_time_ms", quantity: 90 }], known);
    expect(p.health).toEqual({ status: "healthy", responseTimeMs: 90 });
  });

  it("drops non-numeric quantities from business records", () => {
    const p = partitionEvents([{ metric: "page_views" }], known);
    expect(p.business).toHaveLength(0);
  });
});

describe("inferUnit", () => {
  it("infers from suffixes, honors explicit units", () => {
    expect(inferUnit("load_time_ms")).toBe("ms");
    expect(inferUnit("avg_session_seconds")).toBe("s");
    expect(inferUnit("storage_mb")).toBe("mb");
    expect(inferUnit("page_views")).toBeNull();
    expect(inferUnit("page_views", "views")).toBe("views");
  });
});
