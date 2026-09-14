import { describe, expect, it } from "vitest";
import { deriveDnsState } from "./dns-state";

const base = {
  managedByPartner: false,
  domainUrl: "https://example.com",
  hasVerifyToken: false,
  expectedCname: null,
  expectedAIps: null,
  dnsLastOk: null,
};

describe("deriveDnsState", () => {
  it("has no state without a domain", () => {
    expect(deriveDnsState({ ...base, domainUrl: null })).toBe("no_domain");
  });
  it("is unconfigured until something to verify exists", () => {
    expect(deriveDnsState(base)).toBe("unconfigured");
    expect(deriveDnsState({ ...base, hasVerifyToken: true })).toBe("configured");
    expect(deriveDnsState({ ...base, expectedCname: "edge.railway.app" })).toBe("configured");
  });
  it("reports the last verification result once one exists", () => {
    expect(deriveDnsState({ ...base, hasVerifyToken: true, dnsLastOk: true })).toBe("verified");
    expect(deriveDnsState({ ...base, hasVerifyToken: true, dnsLastOk: false })).toBe("failing");
  });
  it("uses the handshake states for partner-managed products", () => {
    expect(deriveDnsState({ ...base, managedByPartner: true, domainUrl: null })).toBe("handshake_pending");
    expect(deriveDnsState({ ...base, managedByPartner: true })).toBe("provisioned");
  });
});
