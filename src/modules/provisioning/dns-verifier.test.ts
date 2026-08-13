import { describe, expect, it } from "vitest";
import { hostFromUrl, verifyDomain, type DnsResolver } from "./dns-verifier";

function resolver(over: Partial<DnsResolver>): DnsResolver {
  return {
    resolveTxt: async () => [],
    resolveCname: async () => [],
    resolve4: async () => [],
    ...over,
  };
}

describe("hostFromUrl", () => {
  it("handles bare domains and full URLs", () => {
    expect(hostFromUrl("https://acme.com/path")).toBe("acme.com");
    expect(hostFromUrl("acme.com")).toBe("acme.com");
  });
});

describe("verifyDomain", () => {
  it("TXT mode matches the token case-insensitively across chunks", async () => {
    const r = await verifyDomain(
      { domainUrl: "acme.com", verifyToken: "ABC-123" },
      resolver({ resolveTxt: async () => [["PLAIDWARE-VERIFY=abc", "-123"]] }),
    );
    expect(r).toMatchObject({ ok: true, mode: "txt" });
  });

  it("TXT mode fails without the token and survives resolver errors", async () => {
    const r = await verifyDomain(
      { domainUrl: "acme.com", verifyToken: "tok" },
      resolver({ resolveTxt: async () => { throw new Error("NXDOMAIN"); } }),
    );
    expect(r).toMatchObject({ ok: false, mode: "txt" });
  });

  it("CNAME mode normalizes trailing dots and case", async () => {
    const r = await verifyDomain(
      { domainUrl: "www.acme.com", expectedCname: "edge.plaidware.com" },
      resolver({ resolveCname: async () => ["EDGE.plaidware.com."] }),
    );
    expect(r).toMatchObject({ ok: true, mode: "cname" });
  });

  it("A-record mode checks the allow-list", async () => {
    const cfg = { domainUrl: "acme.com", expectedAIps: ["1.2.3.4", "5.6.7.8"] };
    expect(
      (await verifyDomain(cfg, resolver({ resolve4: async () => ["9.9.9.9", "5.6.7.8"] }))).ok,
    ).toBe(true);
    expect(
      (await verifyDomain(cfg, resolver({ resolve4: async () => ["9.9.9.9"] }))).ok,
    ).toBe(false);
  });

  it("token takes precedence over routing checks", async () => {
    const r = await verifyDomain(
      { domainUrl: "acme.com", verifyToken: "t", expectedCname: "x.com" },
      resolver({ resolveTxt: async () => [["plaidware-verify=t"]] }),
    );
    expect(r.mode).toBe("txt");
  });

  it("unconfigured fails with guidance", async () => {
    const r = await verifyDomain({ domainUrl: "acme.com" }, resolver({}));
    expect(r).toMatchObject({ ok: false, mode: "unconfigured" });
  });
});
