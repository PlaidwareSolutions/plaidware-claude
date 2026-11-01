import { describe, expect, it } from "vitest";
import { isPrivateAddress, parseLinkMeta, previewableUrl } from "./link-preview-logic";

describe("previewableUrl", () => {
  it("allows public http(s) on default ports", () => {
    expect(previewableUrl("https://stripe.com/docs")?.hostname).toBe("stripe.com");
    expect(previewableUrl("http://example.org:80/a")?.hostname).toBe("example.org");
  });
  it("refuses other schemes, ports, credentials and internal names", () => {
    for (const u of ["javascript:alert(1)", "file:///etc/passwd", "ftp://x.com", "https://x.com:8443", "https://user:pw@x.com", "http://localhost/", "http://db.internal/", "http://printer.local/", "nope"]) {
      expect(previewableUrl(u)).toBeNull();
    }
  });
});

describe("isPrivateAddress", () => {
  it("flags private, loopback, link-local, metadata and mapped addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd12::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });
  it("lets public addresses through", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "104.16.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });
});

describe("parseLinkMeta", () => {
  it("prefers OpenGraph, decodes entities and resolves the image against the page", () => {
    const html = `<html><head><title>Fallback</title>
      <meta property="og:title" content="Refunds &amp; disputes">
      <meta name="description" content="How refunds work &#8212; partial and full.">
      <meta property="og:site_name" content="Stripe Docs">
      <meta content="/img/og.png" property="og:image"></head>`;
    expect(parseLinkMeta(html, "https://stripe.com/docs/refunds")).toEqual({
      url: "https://stripe.com/docs/refunds",
      title: "Refunds & disputes",
      description: "How refunds work — partial and full.",
      siteName: "Stripe Docs",
      image: "https://stripe.com/img/og.png",
    });
  });
  it("falls back to <title> and drops non-https images", () => {
    const p = parseLinkMeta(`<title> Plain   page </title><meta property="og:image" content="http://x.com/a.png">`, "https://x.com");
    expect(p.title).toBe("Plain page");
    expect(p.image).toBeNull();
    expect(p.description).toBeNull();
  });
});
