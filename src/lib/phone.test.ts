import { describe, expect, it } from "vitest";
import { formatPhone, isPlaceholderPhone, normalizePhone, PLACEHOLDER_PHONE } from "./phone";

describe("normalizePhone", () => {
  it("assumes US for 10 digits and keeps explicit country codes", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("1 555 123 4567")).toBe("+15551234567");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("rejects things that are not phone numbers", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("call me")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("placeholder + format", () => {
  it("flags the onboarding placeholder", () => {
    expect(isPlaceholderPhone(PLACEHOLDER_PHONE)).toBe(true);
    expect(isPlaceholderPhone("+15551234567")).toBe(false);
    expect(isPlaceholderPhone(null)).toBe(true);
  });
  it("formats US numbers and leaves others alone", () => {
    expect(formatPhone("+15551234567")).toBe("(555) 123-4567");
    expect(formatPhone("+442079460958")).toBe("+442079460958");
    expect(formatPhone(PLACEHOLDER_PHONE)).toBe("—");
  });
});
