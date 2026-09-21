import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatDay,
  formatMonth,
  formatRelative,
  formatUtcHour,
  fromIsoDay,
  isoDay,
  monthBounds,
  monthKey,
  monthKeysBetween,
} from "./dates";

// Tests run without NEXT_PUBLIC_DISPLAY_TZ → display zone is UTC.
const T = new Date("2026-09-13T14:05:30Z");

describe("dates", () => {
  it("formats absolute dates in the display zone", () => {
    expect(formatDate(T)).toBe("Sep 13, 2026");
    expect(formatDateTime(T)).toBe("Sep 13, 2026, 14:05");
    expect(formatDay(T)).toBe("Sep 13");
    expect(formatDate(T.toISOString())).toBe("Sep 13, 2026");
  });

  it("renders a dash for nothing / garbage", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDay("not a date")).toBe("—");
    expect(formatMonth("2026")).toBe("—");
  });

  it("gives the calendar day in the display zone", () => {
    expect(isoDay("2026-09-13T23:30:00Z", "America/Chicago")).toBe("2026-09-13");
    expect(isoDay("2026-09-14T03:00:00Z", "America/Chicago")).toBe("2026-09-13");
    expect(isoDay("2026-09-14T03:00:00Z", "UTC")).toBe("2026-09-14");
    expect(isoDay(T)).toBe("2026-09-13");
  });

  it("formats UTC job times regardless of display zone", () => {
    expect(formatUtcHour("2026-10-01T08:00:00Z")).toBe("Oct 1 · 08:00 UTC");
  });

  it("formats relative time", () => {
    const now = new Date("2026-09-13T17:05:30Z");
    expect(formatRelative(T, now)).toBe("3 hours ago");
    expect(formatRelative("2026-09-15T17:05:30Z", now)).toBe("in 2 days");
    expect(formatRelative("2026-09-13T17:05:00Z", now)).toBe("just now");
  });

  it("formats month keys", () => {
    expect(formatMonth("2026-09")).toBe("September 2026");
  });
});

describe("calendar helpers", () => {
  it("fromIsoDay pins a calendar day to noon UTC so it renders as itself everywhere", () => {
    expect(fromIsoDay("2026-09-20")).toBe("2026-09-20T12:00:00.000Z");
    expect(formatDate(fromIsoDay("2026-09-20"))).toBe("Sep 20, 2026");
    expect(isoDay(fromIsoDay("2026-09-20"), "America/Chicago")).toBe("2026-09-20");
    expect(() => fromIsoDay("2026-9-2")).toThrow();
  });

  it("monthKey is the display-zone month", () => {
    expect(monthKey("2026-09-13T14:05:30Z")).toBe("2026-09");
    expect(monthKey("2026-10-01T03:00:00Z", "America/Chicago")).toBe("2026-09");
    expect(monthKey("2026-10-01T03:00:00Z", "UTC")).toBe("2026-10");
  });

  it("monthBounds are local midnights on the 1st, DST-safe", () => {
    const utc = monthBounds("2026-07", "UTC");
    expect(utc.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(utc.end.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    const chi = monthBounds("2026-07", "America/Chicago"); // CDT = UTC-5
    expect(chi.start.toISOString()).toBe("2026-07-01T05:00:00.000Z");
    const dec = monthBounds("2026-12", "America/Chicago"); // CST = UTC-6, year rollover
    expect(dec.start.toISOString()).toBe("2026-12-01T06:00:00.000Z");
    expect(dec.end.toISOString()).toBe("2027-01-01T06:00:00.000Z");
    expect(() => monthBounds("2026-13")).toThrow();
  });

  it("monthKeysBetween is inclusive and ordered", () => {
    expect(monthKeysBetween("2026-07", "2026-09")).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(monthKeysBetween("2026-11", "2027-01")).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(monthKeysBetween("2026-09", "2026-09")).toEqual(["2026-09"]);
    expect(monthKeysBetween("2026-10", "2026-09")).toEqual([]);
  });
});
