import { describe, expect, it } from "vitest";
import { buildAttentionItems } from "./client-attention";

const base = {
  tenantId: "t1",
  status: "active",
  subscriptions: [],
  wontAutoCollect: [],
  pastDueCount: 0,
  provisioning: [],
  incidents: [],
  quiet: [],
  setupInvites: [],
  deliveries: { dead: 0, pending: 0 },
  members: [{ role: "owner", lastSeenAt: new Date(), phone: "+15551234567", emailVerified: true }],
  roleRequests: [],
};
const now = new Date("2026-09-14T12:00:00Z");

describe("buildAttentionItems", () => {
  it("is empty for a healthy client", () => {
    expect(buildAttentionItems(base, now)).toEqual([]);
  });

  it("surfaces open role requests, nudging after three days", () => {
    const items = buildAttentionItems(
      {
        ...base,
        roleRequests: [
          { id: "r1", requesterName: "Ada", requestedRole: "billing", createdAt: "2026-09-13T12:00:00Z" },
          { id: "r2", requesterName: "Bob", requestedRole: "admin", createdAt: "2026-09-01T12:00:00Z" },
        ],
      },
      now,
    );
    expect(items.map((i) => [i.key, i.tone])).toEqual([
      ["role-req-r1", "info"],
      ["role-req-r2", "warning"],
    ]);
    expect(items[0].title).toBe("Ada asked to become billing");
    expect(items[0].href).toBe("/ops/clients/t1/people");
  });

  it("covers the three incident classes", () => {
    const items = buildAttentionItems(
      {
        ...base,
        provisioning: [{ subscriptionId: "s1", productName: "Company Website", state: "unconfigured" }],
        setupInvites: [
          { id: "i1", status: "pending", isExpired: true, expiresAt: "2026-09-01T00:00:00Z", clientEmail: "a@b.co" },
        ],
        wontAutoCollect: [{ subscriptionId: "s1", productName: "Company Website", reason: "stripe emails a payment link and no card is on file" }],
      },
      now,
    );
    expect(items.map((i) => i.key)).toEqual(["collect-s1", "dns-unconf-s1", "invite-expired-i1"]);
    expect(items.find((i) => i.key === "dns-unconf-s1")?.href).toBe("/ops/clients/t1/provisioning");
    expect(items.find((i) => i.key === "invite-expired-i1")?.href).toBe("/ops/clients/t1");
  });

  it("distinguishes manual holds from dunning holds", () => {
    const items = buildAttentionItems(
      {
        ...base,
        subscriptions: [
          { id: "s1", productName: "A", status: "suspended", suspensionSource: "manual" },
          { id: "s2", productName: "B", status: "suspended", suspensionSource: "dunning" },
        ],
      },
      now,
    );
    expect(items[0].detail).toMatch(/Manual hold/);
    expect(items[1].detail).toMatch(/Dunning hold/);
  });

  it("warns about links expiring within three days and placeholder phones", () => {
    const items = buildAttentionItems(
      {
        ...base,
        setupInvites: [{ id: "i2", status: "pending", isExpired: false, expiresAt: "2026-09-16T12:00:00Z", clientEmail: "c@d.co" }],
        members: [{ role: "owner", lastSeenAt: null, phone: "+10000000000", emailVerified: false }],
      },
      now,
    );
    expect(items.map((i) => i.key)).toEqual(["invite-soon-i2", "owner-never", "owner-phone"]);
    expect(items[0].title).toMatch(/expires in 2 days/);
  });
});
