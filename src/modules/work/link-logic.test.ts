import { describe, expect, it } from "vitest";
import { fileAttachmentType, fileExtension, formatBytes, isInlineImage, FILE_MAX_BYTES } from "./attachment-logic";
import { cloneTitle, LINK_CHOICES, linkGroupRank, linkPhrase, linkRow, parseItemKey } from "./link-logic";

describe("link phrases", () => {
  it("reads each end of a link with its own phrase", () => {
    expect(linkPhrase("blocks", "outward")).toBe("blocks");
    expect(linkPhrase("blocks", "inward")).toBe("is blocked by");
    expect(linkPhrase("duplicates", "inward")).toBe("is duplicated by");
    expect(linkPhrase("clones", "inward")).toBe("is cloned by");
    expect(linkPhrase("relates", "inward")).toBe("relates to");
  });

  it("stores a link from its outward side", () => {
    expect(linkRow({ itemId: "a", otherItemId: "b", type: "blocks", direction: "outward" })).toEqual({ sourceItemId: "a", targetItemId: "b", type: "blocks" });
    // "A is blocked by B" is stored as B blocks A.
    expect(linkRow({ itemId: "a", otherItemId: "b", type: "blocks", direction: "inward" })).toEqual({ sourceItemId: "b", targetItemId: "a", type: "blocks" });
    // relates has no direction.
    expect(linkRow({ itemId: "a", otherItemId: "b", type: "relates", direction: "inward" })).toEqual({ sourceItemId: "a", targetItemId: "b", type: "relates" });
  });

  it("offers one picker choice per distinct phrase, blockers grouped first", () => {
    expect(new Set(LINK_CHOICES.map((c) => c.label)).size).toBe(LINK_CHOICES.length);
    expect(linkGroupRank("is blocked by")).toBeLessThan(linkGroupRank("relates to"));
    expect(linkGroupRank("something else")).toBeGreaterThan(linkGroupRank("is cloned by"));
  });
});

describe("item keys and clones", () => {
  it("parses a key in any case, else null for a title search", () => {
    expect(parseItemKey("fixo-12")).toEqual({ prefix: "FIXO", number: 12 });
    expect(parseItemKey(" PROP - 3 ")).toEqual({ prefix: "PROP", number: 3 });
    expect(parseItemKey("refund rounding")).toBeNull();
    expect(parseItemKey("12")).toBeNull();
  });

  it("prefixes a clone's summary like Jira and keeps it within the limit", () => {
    expect(cloneTitle("Printer jams")).toBe("CLONE - Printer jams");
    expect(cloneTitle("x".repeat(400))).toHaveLength(300);
  });
});

describe("attached files", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  it("takes the type from the extension, never the browser", () => {
    expect(fileAttachmentType("report.PDF", new Uint8Array([1, 2, 3]))).toEqual({ type: "application/pdf" });
    expect(fileAttachmentType("data.xlsx", new Uint8Array([1]))).toEqual({ type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    expect(fileAttachmentType("shot.png", png)).toEqual({ type: "image/png" });
  });

  it("refuses unknown types, empty or oversized files, and images that aren't", () => {
    expect(fileAttachmentType("evil.exe", new Uint8Array([1]))).toHaveProperty("problem");
    expect(fileAttachmentType("page.html", new Uint8Array([1]))).toHaveProperty("problem");
    expect(fileAttachmentType("logo.svg", new Uint8Array([1]))).toHaveProperty("problem");
    expect(fileAttachmentType("a.pdf", new Uint8Array(0))).toHaveProperty("problem");
    expect(fileAttachmentType("a.pdf", new Uint8Array(FILE_MAX_BYTES + 1))).toHaveProperty("problem");
    expect(fileAttachmentType("fake.png", new Uint8Array([1, 2, 3]))).toHaveProperty("problem");
  });

  it("only verified image types are shown inline", () => {
    expect(isInlineImage("image/png")).toBe(true);
    expect(isInlineImage("application/pdf")).toBe(false);
    expect(isInlineImage("image/svg+xml")).toBe(false);
  });

  it("reads the extension after the last dot only", () => {
    expect(fileExtension("report.final.PDF")).toBe("pdf");
    expect(fileExtension("cvjpg")).toBe("");
    expect(fileExtension("README")).toBe("");
  });

  it("formats sizes", () => {
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(830 * 1024)).toBe("830 KB");
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
  });
});
