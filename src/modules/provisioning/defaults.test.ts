import { describe, expect, it } from "vitest";
import { resolveDnsDefaults } from "./defaults";

describe("resolveDnsDefaults", () => {
  it("prefers product defaults over the platform fallback", () => {
    expect(
      resolveDnsDefaults(
        { defaultExpectedCname: "sites.plaidware.com", defaultExpectedAIps: null },
        { cname: "edge.railway.app", aIps: "1.1.1.1" },
      ),
    ).toEqual({ expectedCname: "sites.plaidware.com", expectedAIps: "1.1.1.1" });
  });
  it("falls back to env, then blank", () => {
    expect(resolveDnsDefaults(null, { cname: " edge.railway.app ", aIps: "" })).toEqual({
      expectedCname: "edge.railway.app",
      expectedAIps: null,
    });
    expect(resolveDnsDefaults(null, {})).toEqual({ expectedCname: null, expectedAIps: null });
  });
});
