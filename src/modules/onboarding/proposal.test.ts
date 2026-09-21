import { describe, expect, it } from "vitest";
import {
  buildProductProposal,
  combineTotals,
  pickPrimaryIndex,
  type InviteProductEntry,
  type ProposalComponent,
} from "./proposal";

const entry = (productId: string, componentIds: string[], domainUrl: string | null = null): InviteProductEntry => ({
  productId,
  componentIds,
  domainUrl,
});

const comp = (over: Partial<ProposalComponent> & { id: string }): ProposalComponent => ({
  name: over.id,
  kind: "recurring",
  interval: "month",
  intervalCount: 1,
  amountCents: 1000,
  sortOrder: 0,
  ...over,
});

describe("buildProductProposal", () => {
  it("applies overrides, sums first-period totals, splits monthly vs yearly", () => {
    const comps = [
      comp({ id: "build", kind: "one_time", interval: null, amountCents: 450000, sortOrder: 0 }),
      comp({ id: "hosting", amountCents: 7900, sortOrder: 1 }),
      comp({ id: "maint", interval: "year", amountCents: 96000, sortOrder: 2 }),
    ];
    const p = buildProductProposal(
      entry("web", ["build", "hosting", "maint"], "https://x.com"),
      "Company Website",
      comps,
      new Map([
        ["build", 100], // waived to $1
        ["hosting", 2500],
      ]),
    );
    expect(p.productName).toBe("Company Website");
    expect(p.domainUrl).toBe("https://x.com");
    expect(p.dueTodayCents).toBe(100 + 2500 + 96000);
    expect(p.monthlyCents).toBe(2500);
    expect(p.yearlyCents).toBe(96000);
    expect(p.lines.map((l) => l.name)).toEqual(["build", "hosting", "maint"]);
    expect(p.lines[0]).toMatchObject({ oneTime: true, cadence: "one-time", amountCents: 100 });
  });

  it("respects sortOrder and list prices without overrides", () => {
    const comps = [
      comp({ id: "b", sortOrder: 2, amountCents: 200 }),
      comp({ id: "a", sortOrder: 1, amountCents: 100 }),
    ];
    const p = buildProductProposal(entry("x", ["a", "b"]), "X", comps, new Map());
    expect(p.lines.map((l) => l.name)).toEqual(["a", "b"]);
    expect(p.dueTodayCents).toBe(300);
    expect(p.monthlyCents).toBe(300);
  });
});

describe("combineTotals", () => {
  it("sums across products", () => {
    const a = buildProductProposal(
      entry("p1", ["c1"]),
      "P1",
      [comp({ id: "c1", amountCents: 5000 })],
      new Map(),
    );
    const b = buildProductProposal(
      entry("p2", ["c2"]),
      "P2",
      [comp({ id: "c2", kind: "one_time", interval: null, amountCents: 150000 })],
      new Map(),
    );
    expect(combineTotals([a, b])).toEqual({
      dueTodayCents: 155000,
      monthlyCents: 5000,
      yearlyCents: 0,
    });
  });
});

describe("pickPrimaryIndex", () => {
  const recurringIds = new Set(["hosting", "seo"]);
  const isRecurring = (id: string) => recurringIds.has(id);

  it("prefers the first entry containing a recurring component", () => {
    const entries = [
      entry("p1", ["build"]), // one-time only
      entry("p2", ["audit", "seo"]),
      entry("p3", ["hosting"]),
    ];
    expect(pickPrimaryIndex(entries, isRecurring)).toBe(1);
  });

  it("falls back to the first entry when nothing recurs", () => {
    expect(pickPrimaryIndex([entry("p1", ["build"]), entry("p2", ["audit"])], isRecurring)).toBe(0);
  });

  it("single-product degenerate case", () => {
    expect(pickPrimaryIndex([entry("p1", ["hosting"])], isRecurring)).toBe(0);
  });
});

describe("invite-held pricing (items shape)", () => {
  it("reads component ids from items, with legacy componentIds as fallback", async () => {
    const { entryComponentIds, entryPriceMap } = await import("./proposal");
    const modern: InviteProductEntry = {
      productId: "p",
      items: [
        { componentId: "a", priceCents: null },
        { componentId: "b", priceCents: 500 },
      ],
      domainUrl: null,
    };
    expect(entryComponentIds(modern)).toEqual(["a", "b"]);
    expect([...entryPriceMap(modern)]).toEqual([["b", 500]]);
    expect(entryComponentIds({ productId: "p", componentIds: ["z"], domainUrl: null })).toEqual(["z"]);
  });

  it("lets a held price beat a tenant override, which beats list", () => {
    const comps = [comp({ id: "a", amountCents: 1000 }), comp({ id: "b", amountCents: 2000 }), comp({ id: "c", amountCents: 3000 })];
    const p = buildProductProposal(
      { productId: "p", items: [{ componentId: "a", priceCents: 100 }, { componentId: "b", priceCents: null }, { componentId: "c", priceCents: null }], domainUrl: null },
      "P",
      comps,
      new Map([["a", 900], ["b", 1500]]),
    );
    expect(p.lines.map((l) => l.amountCents)).toEqual([100, 1500, 3000]);
    expect(p.componentIds).toEqual(["a", "b", "c"]);
  });
});

describe("quantities, settlement and backdating on a setup link", () => {
  const comps = [
    comp({ id: "onb", name: "School Onboarding", kind: "one_time", interval: null, amountCents: 120000, sortOrder: 0 }),
    comp({ id: "sub", name: "Subscription", amountCents: 12900, sortOrder: 1 }),
    comp({ id: "extra", name: "Extra Location", amountCents: 5900, sortOrder: 2 }),
    comp({ id: "maint", name: "Maintenance", interval: "year", amountCents: 12000, sortOrder: 3 }),
  ];
  const dealEntry: InviteProductEntry = {
    productId: "drivorata",
    items: [
      { componentId: "onb", priceCents: 50000, settlement: { mode: "offline", invoiceId: "inv_1", payment: { method: "cash", reference: null, receivedAt: null } } },
      { componentId: "sub", priceCents: 4000 },
      { componentId: "extra", priceCents: 100, quantity: 2 },
      { componentId: "maint", priceCents: 100 },
    ],
    domainUrl: null,
  };

  it("multiplies by quantity and leaves offline-settled work out of due today", () => {
    const p = buildProductProposal(dealEntry, "Drivorata", comps, new Map());
    expect(p.lines.map((l) => [l.name, l.amountCents, l.quantity, l.settled])).toEqual([
      ["School Onboarding", 50000, 1, true],
      ["Subscription", 4000, 1, false],
      ["Extra Location", 200, 2, false],
      ["Maintenance", 100, 1, false],
    ]);
    expect(p.dueTodayCents).toBe(4300);
    expect(p.monthlyCents).toBe(4200);
    expect(p.yearlyCents).toBe(100);
    expect(p.catchUpCents).toBe(0);
    expect(p.items).toEqual([
      { componentId: "onb", quantity: 1, settlement: { mode: "offline", invoiceId: "inv_1" } },
      { componentId: "sub", quantity: 1 },
      { componentId: "extra", quantity: 2 },
      { componentId: "maint", quantity: 1 },
    ]);
  });

  it("waived lines are $0 and flagged", () => {
    const p = buildProductProposal(
      { productId: "p", items: [{ componentId: "onb", priceCents: 0, settlement: { mode: "waive" } }, { componentId: "sub", priceCents: null }], domainUrl: null },
      "P",
      comps.slice(0, 2),
      new Map(),
    );
    expect(p.lines[0]).toMatchObject({ amountCents: 0, waived: true, settled: false });
    expect(p.dueTodayCents).toBe(12900);
    expect(p.items[0]).toEqual({ componentId: "onb", quantity: 1, settlement: { mode: "waive" } });
  });

  it("a backdated entry replaces the first period with per-month catch-up lines as of now", () => {
    const p = buildProductProposal({ ...dealEntry, billFromMonth: "2026-07" }, "Drivorata", comps, new Map(), {
      now: new Date("2026-09-20T15:00:00Z"),
      timeZone: "UTC",
    });
    const catchUp = p.lines.filter((l) => l.catchUp);
    expect(catchUp.map((l) => [l.name, l.amountCents])).toEqual([
      ["Subscription — July 2026", 4000],
      ["Subscription — August 2026", 4000],
      ["Subscription — September 2026", 4000],
      ["Extra Location ×2 — July 2026", 200],
      ["Extra Location ×2 — August 2026", 200],
      ["Extra Location ×2 — September 2026", 200],
      ["Maintenance — Jul 1 – Sep 30, 2026 (prorated)", 25],
    ]);
    expect(p.catchUpCents).toBe(12625);
    expect(p.dueTodayCents).toBe(12625);
    expect(p.billFromMonth).toBe("2026-07");
    expect(p.monthlyCents).toBe(4200);
    // Paid a month later: October joins the catch-up.
    const later = buildProductProposal({ ...dealEntry, billFromMonth: "2026-07" }, "Drivorata", comps, new Map(), {
      now: new Date("2026-10-03T15:00:00Z"),
      timeZone: "UTC",
    });
    expect(later.lines.filter((l) => l.catchUp && l.name.startsWith("Subscription")).length).toBe(4);
  });

  it("legacy entries map to quantity-1 plans", async () => {
    const { entryItemPlan } = await import("./proposal");
    expect(entryItemPlan({ productId: "p", componentIds: ["a", "b"], domainUrl: null })).toEqual([
      { componentId: "a", quantity: 1 },
      { componentId: "b", quantity: 1 },
    ]);
  });
});
