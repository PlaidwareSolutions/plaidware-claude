import { describe, expect, it } from "vitest";
import { formatCents, toCents } from "./money";

describe("toCents", () => {
  it("parses plain and formatted dollar strings", () => {
    expect(toCents("4500")).toBe(450000);
    expect(toCents("4,500.00")).toBe(450000);
    expect(toCents("$79")).toBe(7900);
    expect(toCents(79.5)).toBe(7950);
  });
  it("rounds sub-cent values", () => {
    expect(toCents(0.015)).toBe(2);
  });
  it("rejects garbage", () => {
    expect(() => toCents("abc")).toThrow();
    expect(() => toCents(Number.NaN)).toThrow();
  });
});

describe("formatCents", () => {
  it("formats USD", () => {
    expect(formatCents(450000)).toBe("$4,500.00");
    expect(formatCents(7900)).toBe("$79.00");
  });
});
