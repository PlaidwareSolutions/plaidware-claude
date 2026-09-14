import { describe, expect, it } from "vitest";
import { summarizeIngestEvents } from "./ingest-health-logic";

describe("summarizeIngestEvents", () => {
  it("rolls up calls, errors, last seen, and unknown keys per subscription", () => {
    const r = summarizeIngestEvents([
      { subscriptionId: "a", ok: true, statusCode: 202, errorMessage: null, unknownKeys: ["foo"], createdAt: "2026-09-10T00:00:00Z" },
      { subscriptionId: "a", ok: false, statusCode: 400, errorMessage: "bad payload", unknownKeys: [], createdAt: "2026-09-11T00:00:00Z" },
      { subscriptionId: "a", ok: true, statusCode: 202, errorMessage: null, unknownKeys: ["bar", "foo"], createdAt: "2026-09-12T00:00:00Z" },
      { subscriptionId: "b", ok: true, statusCode: 202, errorMessage: null, unknownKeys: [], createdAt: "2026-09-12T00:00:00Z" },
    ]);
    expect(r[0]).toEqual({
      subscriptionId: "a",
      calls: 3,
      errors: 1,
      lastAt: "2026-09-12T00:00:00.000Z",
      lastError: "bad payload",
      unknownKeys: ["bar", "foo"],
    });
    expect(r[1]).toMatchObject({ subscriptionId: "b", calls: 1, errors: 0, unknownKeys: [] });
  });
  it("is empty for no events", () => {
    expect(summarizeIngestEvents([])).toEqual([]);
  });
});
