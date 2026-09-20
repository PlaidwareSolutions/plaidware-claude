import { describe, expect, it } from "vitest";
import { defaultKeyPrefix, formatKey, parseKey, uniqueKeyPrefix } from "./key-logic";

describe("defaultKeyPrefix", () => {
  it("takes initials of multi-word slugs, capped at four", () => {
    expect(defaultKeyPrefix("company-website")).toBe("CW");
    expect(defaultKeyPrefix("marketing-hs-foundation")).toBe("MHF");
    expect(defaultKeyPrefix("a-b-c-d-e-f")).toBe("ABCD");
  });
  it("takes the first four letters of a single word", () => {
    expect(defaultKeyPrefix("buildorata")).toBe("BUIL");
    expect(defaultKeyPrefix("fixorata")).toBe("FIXO");
  });
  it("falls back when the slug has no usable letters", () => {
    expect(defaultKeyPrefix("2024")).toBe("WRK");
    expect(defaultKeyPrefix("x")).toBe("WRK");
  });
});

describe("uniqueKeyPrefix", () => {
  it("suffixes a counter until free", () => {
    expect(uniqueKeyPrefix("BUIL", new Set())).toBe("BUIL");
    expect(uniqueKeyPrefix("BUIL", new Set(["BUIL"]))).toBe("BUIL2");
    expect(uniqueKeyPrefix("BUIL", new Set(["BUIL", "BUIL2"]))).toBe("BUIL3");
  });
});

describe("keys", () => {
  it("round-trip", () => {
    expect(formatKey("BLD", 42)).toBe("BLD-42");
    expect(parseKey("BLD-42")).toEqual({ prefix: "BLD", number: 42 });
    expect(parseKey(" bld-7 ")).toEqual({ prefix: "BLD", number: 7 });
  });
  it("reject malformed keys", () => {
    expect(parseKey("BLD42")).toBeNull();
    expect(parseKey("BLD-0")).toBeNull();
    expect(parseKey("-42")).toBeNull();
    expect(parseKey("B-1")).toBeNull();
  });
});
