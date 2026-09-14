import { describe, expect, it } from "vitest";
import { metricDefinitionSchema } from "./contracts";

const base = { productId: "6e0e2b7a-0000-4000-8000-000000000000", label: "Page views" };

describe("metricDefinitionSchema", () => {
  it("accepts snake_case keys with defaults filled", () => {
    const r = metricDefinitionSchema.parse({ ...base, key: "page_views" });
    expect(r).toMatchObject({ key: "page_views", aggregation: "sum", direction: "up_is_good", valueType: "count", isPrimary: false });
  });
  it("rejects reserved health keys and bad spellings", () => {
    expect(() => metricDefinitionSchema.parse({ ...base, key: "status" })).toThrow(/Reserved/);
    expect(() => metricDefinitionSchema.parse({ ...base, key: "response_time_ms" })).toThrow(/Reserved/);
    expect(() => metricDefinitionSchema.parse({ ...base, key: "Page Views" })).toThrow(/snake_case/);
    expect(() => metricDefinitionSchema.parse({ ...base, key: "1abc" })).toThrow();
  });
});
