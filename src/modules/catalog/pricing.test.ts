import { describe, expect, it } from "vitest";
import { baseChargeLabel, cadenceLabel, monthlyFromCents } from "./pricing";

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

describe("catalog pricing", () => {
  it("normalises legacy kinds to a monthly equivalent", () => {
    expect(
      monthlyFromCents([
        { kind: "recurring_monthly", amountCents: 7900 },
        { kind: "recurring_yearly", amountCents: 12000 },
        { kind: "one_time", amountCents: 450000 },
        { kind: "recurring", interval: "month", intervalCount: 3, amountCents: 3000 },
      ]),
    ).toBe(7900 + 1000 + 1000);
  });
  it("skips inactive components", () => {
    expect(monthlyFromCents([{ kind: "recurring", interval: "month", intervalCount: 1, amountCents: 100, isActive: false }])).toBe(0);
  });
  it("labels cadence for any spelling", () => {
    expect(cadenceLabel({ kind: "recurring_monthly", amountCents: 0 })).toBe("/mo");
    expect(cadenceLabel({ kind: "recurring", interval: "year", intervalCount: 1, amountCents: 0 })).toBe("/yr");
    expect(cadenceLabel({ kind: "one_time", amountCents: 0 })).toBe("one-time");
  });
  it("prefers the base charge for the headline", () => {
    expect(
      baseChargeLabel(
        [
          { kind: "one_time", role: "addon", amountCents: 450000 },
          { kind: "recurring", role: "base", interval: "month", intervalCount: 1, amountCents: 7900 },
        ],
        fmt,
      ),
    ).toBe("$79.00/mo");
    expect(baseChargeLabel([{ kind: "one_time", amountCents: 100 }], fmt)).toBe("$1.00 one-time");
    expect(baseChargeLabel([], fmt)).toBeNull();
  });
});
