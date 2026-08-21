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
