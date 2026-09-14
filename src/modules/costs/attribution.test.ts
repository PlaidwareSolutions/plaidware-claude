import { describe, expect, it } from "vitest";
import { attributeTenantCosts } from "./attribution";

describe("attributeTenantCosts", () => {
  it("sends dedicated apps to their subscription's tenant and splits shared apps", () => {
    const r = attributeTenantCosts({
      apps: [
        { id: "app-shared", label: "web-fleet", costCents: 3000 },
        { id: "app-dedicated", label: "acme-prod", costCents: 1200 },
        { id: "app-nocost", label: "idle", costCents: null },
      ],
      links: [
        { hostedAppId: "app-shared", productId: "web", subscriptionId: null },
        { hostedAppId: "app-dedicated", productId: "custom", subscriptionId: "s-acme" },
        { hostedAppId: "app-nocost", productId: "web", subscriptionId: null },
      ],
      subscriptions: [
        { id: "s-acme", tenantId: "acme", productId: "custom" },
        { id: "s-acme-web", tenantId: "acme", productId: "web" },
        { id: "s-bee", tenantId: "bee", productId: "web" },
        { id: "s-cee", tenantId: "cee", productId: "web" },
      ],
    });
    expect(r.get("acme")?.costCents).toBe(1200 + 1000);
    expect(r.get("bee")?.costCents).toBe(1000);
    expect(r.get("cee")?.costCents).toBe(1000);
    expect(r.get("acme")?.apps.map((a) => a.basis).sort()).toEqual(["dedicated", "shared"]);
  });
  it("ignores apps nobody is linked to", () => {
    const r = attributeTenantCosts({
      apps: [{ id: "a", label: "orphan", costCents: 500 }],
      links: [],
      subscriptions: [{ id: "s", tenantId: "t", productId: "p" }],
    });
    expect(r.size).toBe(0);
  });
});
