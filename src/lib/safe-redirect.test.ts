import { describe, expect, it } from "vitest";
import { resolveRedirect } from "./safe-redirect";

describe("resolveRedirect", () => {
  it("defaults to /dashboard", () => {
    expect(resolveRedirect(null)).toEqual({ url: "/dashboard", external: false });
    expect(resolveRedirect("")).toEqual({ url: "/dashboard", external: false });
  });

  it("passes through same-app paths", () => {
    expect(resolveRedirect("/billing?tab=invoices")).toEqual({
      url: "/billing?tab=invoices",
      external: false,
    });
  });

  it("rejects protocol-relative URLs", () => {
    expect(resolveRedirect("//evil.com/x")).toEqual({ url: "/dashboard", external: false });
  });

  it("allows https plaidware.com subdomains (MHub hand-off)", () => {
    expect(resolveRedirect("https://mhub-staging.plaidware.com/app")).toEqual({
      url: "https://mhub-staging.plaidware.com/app",
      external: true,
    });
    expect(resolveRedirect("https://plaidware.com/")).toEqual({
      url: "https://plaidware.com/",
      external: true,
    });
  });

  it("rejects other hosts, lookalikes, and non-https schemes", () => {
    for (const raw of [
      "https://evil.com/",
      "https://notplaidware.com/",
      "https://plaidware.com.evil.com/",
      "http://mhub-staging.plaidware.com/app",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(resolveRedirect(raw)).toEqual({ url: "/dashboard", external: false });
    }
  });
});
