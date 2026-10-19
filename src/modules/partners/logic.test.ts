import { describe, expect, it } from "vitest";
import {
  billingStatusFor,
  describePaymentMethod,
  hashPartnerKey,
  isAllowedReturnUrl,
  normalizeOrigin,
  prefixProblem,
  parsePartnerActor,
  partnerActorLabel,
  partnerKeyAllows,
  planItemChanges,
  planKeyFor,
} from "./logic";

describe("hashPartnerKey", () => {
  it("is a deterministic sha256 hex of the whole raw key", () => {
    const h = hashPartnerKey("ppk_abc123");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashPartnerKey("ppk_abc123"));
    expect(h).not.toBe(hashPartnerKey("ppk_abc124"));
  });
});

describe("partnerKeyAllows", () => {
  it("allows an exact allowlist match", () => {
    expect(partnerKeyAllows(["marketing-"], "marketing-")).toBe(true);
  });

  it("allows a narrower request than the grant", () => {
    expect(partnerKeyAllows(["marketing-"], "marketing-hs-")).toBe(true);
  });

  it("rejects a broader or unrelated request", () => {
    expect(partnerKeyAllows(["marketing-hs-"], "marketing-")).toBe(false);
    expect(partnerKeyAllows(["marketing-"], "fixorata")).toBe(false);
  });

  it("rejects empty requests and empty grants", () => {
    expect(partnerKeyAllows(["marketing-"], "")).toBe(false);
    expect(partnerKeyAllows([], "marketing-")).toBe(false);
    expect(partnerKeyAllows([""], "marketing-")).toBe(false);
  });
});

describe("billingStatusFor", () => {
  it("maps no subscription to none and incomplete to pending", () => {
    expect(billingStatusFor(null)).toBe("none");
    expect(billingStatusFor(undefined)).toBe("none");
    expect(billingStatusFor("incomplete")).toBe("pending");
  });

  it("passes the remaining statuses through", () => {
    for (const s of ["trialing", "active", "past_due", "suspended", "canceled", "expired"]) {
      expect(billingStatusFor(s)).toBe(s);
    }
  });

  it("treats unknown values as none", () => {
    expect(billingStatusFor("weird")).toBe("none");
  });

  it("folds a Hub workspace hold into suspended for live subscriptions only", () => {
    expect(billingStatusFor("active", "suspended")).toBe("suspended");
    expect(billingStatusFor("trialing", "inactive")).toBe("suspended");
    expect(billingStatusFor("past_due", "suspended")).toBe("suspended");
    expect(billingStatusFor("canceled", "inactive")).toBe("canceled");
    expect(billingStatusFor("active", "active")).toBe("active");
  });
});

describe("planKeyFor", () => {
  it("is custom only with a negotiated base price", () => {
    expect(planKeyFor(true)).toBe("custom");
    expect(planKeyFor(false)).toBe("standard");
  });
});

describe("isAllowedReturnUrl", () => {
  const origins = ["https://fixorata.com", "http://localhost:5000"];

  it("allows URLs on a registered origin", () => {
    expect(isAllowedReturnUrl("https://fixorata.com/billing?paid=1", origins)).toBe(true);
    expect(isAllowedReturnUrl("http://localhost:5000/billing", origins)).toBe(true);
  });

  it("rejects other origins, lookalikes, schemes and credentials", () => {
    expect(isAllowedReturnUrl("https://evil.com/billing", origins)).toBe(false);
    expect(isAllowedReturnUrl("https://fixorata.com.evil.com/", origins)).toBe(false);
    expect(isAllowedReturnUrl("http://fixorata.com/billing", origins)).toBe(false);
    expect(isAllowedReturnUrl("http://localhost:5001/", origins)).toBe(false);
    expect(isAllowedReturnUrl("javascript:alert(1)", origins)).toBe(false);
    expect(isAllowedReturnUrl("https://user:pw@fixorata.com/", origins)).toBe(false);
    expect(isAllowedReturnUrl("not a url", origins)).toBe(false);
  });
});

describe("parsePartnerActor", () => {
  it("parses a well-formed header and normalises the email", () => {
    expect(
      parsePartnerActor(
        JSON.stringify({ external_user_id: "u1", email: " Owner@Shop.com ", name: "Ann", role: "owner" }),
      ),
    ).toEqual({ externalUserId: "u1", email: "owner@shop.com", name: "Ann", role: "owner" });
  });

  it("rejects missing, malformed or incomplete headers", () => {
    expect(parsePartnerActor(null)).toBeNull();
    expect(parsePartnerActor("{not json")).toBeNull();
    expect(parsePartnerActor(JSON.stringify({ email: "a@b.c" }))).toBeNull();
    expect(parsePartnerActor(JSON.stringify({ external_user_id: "u1", email: "nope" }))).toBeNull();
    expect(parsePartnerActor(JSON.stringify("string"))).toBeNull();
  });
});

describe("partnerActorLabel", () => {
  it("names the app and the acting user", () => {
    expect(
      partnerActorLabel("fixorata", { externalUserId: "u1", email: "a@b.c", name: "", role: "owner" }),
    ).toBe("partner:fixorata/a@b.c");
    expect(partnerActorLabel("fixorata", null)).toBe("partner:fixorata");
  });
});

describe("planItemChanges", () => {
  const addons = [
    { componentId: "term", kind: "recurring" },
    { componentId: "setup2", kind: "one_time" },
  ];
  const current = [
    { id: "it-base", componentId: "base", kind: "recurring", status: "active" },
    { id: "it-term", componentId: "term", kind: "recurring", status: "active" },
  ];

  it("sets an existing recurring add-on to the exact quantity, 0 included", () => {
    expect(planItemChanges(current, addons, [{ componentId: "term", quantity: 3 }])).toEqual({
      addItems: [],
      setQuantities: [{ itemId: "it-term", quantity: 3 }],
    });
    expect(planItemChanges(current, addons, [{ componentId: "term", quantity: 0 }])).toEqual({
      addItems: [],
      setQuantities: [{ itemId: "it-term", quantity: 0 }],
    });
  });

  it("adds a recurring add-on that isn't on the subscription; 0 is a no-op", () => {
    expect(planItemChanges([], addons, [{ componentId: "term", quantity: 2 }])).toEqual({
      addItems: [{ componentId: "term", quantity: 2 }],
      setQuantities: [],
    });
    expect(planItemChanges([], addons, [{ componentId: "term", quantity: 0 }])).toEqual({
      addItems: [],
      setQuantities: [],
    });
  });

  it("treats a one-time add-on as a purchase", () => {
    expect(planItemChanges(current, addons, [{ componentId: "setup2", quantity: 1 }])).toEqual({
      addItems: [{ componentId: "setup2", quantity: 1 }],
      setQuantities: [],
    });
  });

  it("refuses the base charge, unknown components, duplicates and bad quantities", () => {
    expect(planItemChanges(current, addons, [{ componentId: "base", quantity: 2 }])).toHaveProperty("error");
    expect(planItemChanges(current, addons, [{ componentId: "nope", quantity: 1 }])).toHaveProperty("error");
    expect(
      planItemChanges(current, addons, [
        { componentId: "term", quantity: 1 },
        { componentId: "term", quantity: 2 },
      ]),
    ).toHaveProperty("error");
    expect(planItemChanges(current, addons, [{ componentId: "term", quantity: -1 }])).toHaveProperty("error");
    expect(planItemChanges(current, addons, [{ componentId: "term", quantity: 1.5 }])).toHaveProperty("error");
  });
});

describe("prefixProblem", () => {
  const others = [{ name: "Drivorata", prefixes: ["drivorata"] }];

  it("accepts a fresh slug prefix", () => {
    expect(prefixProblem(["fixorata"], others)).toBeNull();
  });

  it("refuses empty, malformed, MHub and overlapping prefixes", () => {
    expect(prefixProblem([], others)).toMatch(/at least one/);
    expect(prefixProblem(["Fix Orata"], others)).toMatch(/lowercase/);
    expect(prefixProblem(["marketing-x"], others)).toMatch(/MHub/);
    expect(prefixProblem(["market"], others)).toMatch(/MHub/);
    expect(prefixProblem(["drivorata-pro"], others)).toMatch(/Drivorata/);
    expect(prefixProblem(["driv"], others)).toMatch(/Drivorata/);
  });
});

describe("normalizeOrigin", () => {
  it("keeps https origins and local http", () => {
    expect(normalizeOrigin("https://fixorata.com/billing")).toBe("https://fixorata.com");
    expect(normalizeOrigin("http://localhost:5000/x")).toBe("http://localhost:5000");
  });

  it("refuses plain http elsewhere and junk", () => {
    expect(normalizeOrigin("http://fixorata.com")).toBeNull();
    expect(normalizeOrigin("ftp://x")).toBeNull();
    expect(normalizeOrigin("nope")).toBeNull();
  });
});

describe("describePaymentMethod", () => {
  it("describes a card", () => {
    expect(describePaymentMethod({ type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } })).toEqual({
      type: "card", brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030, label: "Visa •••• 4242",
    });
  });

  it("describes Link and other wallets without card details", () => {
    expect(describePaymentMethod({ type: "link", link: { email: "a@b.co" } })).toEqual({
      type: "link", brand: null, last4: null, exp_month: null, exp_year: null, label: "Link (a@b.co)",
    });
    expect(describePaymentMethod({ type: "us_bank_account", us_bank_account: { bank_name: "STRIPE TEST BANK", last4: "6789" } })?.label).toBe("STRIPE TEST BANK •••• 6789");
    expect(describePaymentMethod({ type: "cashapp" })?.label).toBe("Cashapp");
  });

  it("is null for nothing or an unexpanded id", () => {
    expect(describePaymentMethod(null)).toBeNull();
    expect(describePaymentMethod("pm_123")).toBeNull();
  });
});
