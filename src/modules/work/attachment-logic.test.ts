import { describe, expect, it } from "vitest";
import { ATTACHMENT_MAX_BYTES, attachmentProblem, sniffImageType } from "./attachment-logic";

const bytes = (...xs: number[]) => new Uint8Array([...xs, ...new Array(16).fill(0)]);

describe("sniffImageType", () => {
  it("recognises the four image signatures", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("image/gif");
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe("image/webp");
  });

  it("refuses SVG, HTML and anything else, whatever the name says", () => {
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20))).toBeNull(); // AVI, not WebP
  });
});

describe("attachmentProblem", () => {
  it("checks emptiness, size and type", () => {
    expect(attachmentProblem(0, "image/png")).toMatch(/empty/);
    expect(attachmentProblem(ATTACHMENT_MAX_BYTES + 1, "image/png")).toMatch(/5 MB/);
    expect(attachmentProblem(10, null)).toMatch(/PNG/);
    expect(attachmentProblem(10, "image/webp")).toBeNull();
  });
});
