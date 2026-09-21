import { describe, expect, it } from "vitest";
import { isCustomPrice, rowsToItems, seedTermRows, type TermComponent } from "./start-form";

const comps: TermComponent[] = [
  { id: "sub", name: "Subscription", kind: "recurring", role: "base", interval: "month", intervalCount: 1, isRequired: true, isActive: true, listCents: 12900, overrideCents: 6999 },
  { id: "extra", name: "Extra Location", kind: "recurring", role: "addon", interval: "month", intervalCount: 1, isRequired: false, isActive: true, listCents: 5900, overrideCents: null },
  { id: "onb", name: "School Onboarding", kind: "one_time", role: "addon", interval: null, intervalCount: 1, isRequired: true, isActive: true, listCents: 120000, overrideCents: 50000 },
  { id: "old", name: "Retired", kind: "recurring", role: "addon", interval: "month", intervalCount: 1, isRequired: false, isActive: false, listCents: 1, overrideCents: null },
];

describe("start-form", () => {
  it("seeds included/locked rows with override-or-list prices and skips inactive components", () => {
    const rows = seedTermRows(comps, "2026-09-20");
    expect(Object.keys(rows)).toEqual(["sub", "extra", "onb"]);
    expect(rows.sub).toMatchObject({ included: true, price: "69.99", quantity: 1, settlement: "invoice" });
    expect(rows.extra).toMatchObject({ included: false, price: "59.00" });
    expect(rows.onb.payment).toEqual({ method: "cash", reference: "", receivedAt: "2026-09-20" });
  });

  it("translates rows to action items: quantities on add-ons only, offline payment day pinned to noon UTC", () => {
    const rows = seedTermRows(comps, "2026-09-20");
    rows.sub.price = "40";
    rows.sub.quantity = 5; // ignored: main charge
    rows.extra = { ...rows.extra, included: true, price: "1.00", quantity: 2 };
    rows.onb = { ...rows.onb, price: "500", settlement: "offline", payment: { method: "cash", reference: " cash 9/20 ", receivedAt: "2026-09-20" } };
    expect(rowsToItems(comps, rows)).toEqual([
      { componentId: "sub", amountCents: 4000, quantity: 1 },
      { componentId: "extra", amountCents: 100, quantity: 2 },
      {
        componentId: "onb",
        amountCents: 50000,
        quantity: 1,
        settlement: { mode: "offline", payment: { method: "cash", reference: "cash 9/20", receivedAt: "2026-09-20T12:00:00.000Z" } },
      },
    ]);
  });

  it("waive forces $0 and a bad amount names the row", () => {
    const rows = seedTermRows(comps, "2026-09-20");
    rows.onb = { ...rows.onb, price: "garbage", settlement: "waive" };
    expect(rowsToItems(comps, rows).find((i) => i.componentId === "onb")).toEqual({ componentId: "onb", amountCents: 0, quantity: 1, settlement: { mode: "waive" } });
    rows.sub.price = "forty";
    expect(() => rowsToItems(comps, rows)).toThrow("Subscription: enter a valid amount");
  });

  it("flags custom prices against list", () => {
    const rows = seedTermRows(comps, "2026-09-20");
    expect(isCustomPrice(comps[0], rows.sub)).toBe(true); // 69.99 vs 129
    expect(isCustomPrice(comps[1], rows.extra)).toBe(false);
    expect(isCustomPrice(comps[2], { ...rows.onb, settlement: "waive" })).toBe(true);
  });
});
