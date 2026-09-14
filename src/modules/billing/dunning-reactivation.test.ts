import { describe, expect, it } from "vitest";
import { isDunningReactivationCandidate } from "./dunning-logic";

describe("isDunningReactivationCandidate", () => {
  it("lifts dunning suspensions and legacy (untagged) ones", () => {
    expect(isDunningReactivationCandidate({ status: "suspended", suspensionSource: "dunning" })).toBe(true);
    expect(isDunningReactivationCandidate({ status: "suspended", suspensionSource: null })).toBe(true);
  });
  it("leaves a manual hold alone", () => {
    expect(isDunningReactivationCandidate({ status: "suspended", suspensionSource: "manual" })).toBe(false);
  });
  it("ignores subscriptions that are not suspended", () => {
    expect(isDunningReactivationCandidate({ status: "active", suspensionSource: "dunning" })).toBe(false);
  });
});
