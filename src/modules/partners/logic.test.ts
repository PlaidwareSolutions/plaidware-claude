import { describe, expect, it } from "vitest";
import { hashPartnerKey, partnerKeyAllows } from "./logic";

describe("hashPartnerKey", () => {
  it("is a deterministic sha256 hex of the whole raw key", () => {
    const h = hashPartnerKey("ppk_abc123");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashPartnerKey("ppk_abc123"));
    expect(h).not.toBe(hashPartnerKey("ppk_abc124"));
  });
});

describe("partnerKeyAllows", () => {
  it("allows an exact allowlist match", () => {
    expect(partnerKeyAllows(["marketing-"], "marketing-")).toBe(true);
  });

  it("allows a narrower request than the grant", () => {
    expect(partnerKeyAllows(["marketing-"], "marketing-hs-")).toBe(true);
  });

  it("rejects a broader or unrelated request", () => {
    expect(partnerKeyAllows(["marketing-hs-"], "marketing-")).toBe(false);
    expect(partnerKeyAllows(["marketing-"], "fixorata")).toBe(false);
  });

  it("rejects empty requests and empty grants", () => {
    expect(partnerKeyAllows(["marketing-"], "")).toBe(false);
    expect(partnerKeyAllows([], "marketing-")).toBe(false);
    expect(partnerKeyAllows([""], "marketing-")).toBe(false);
  });
});
