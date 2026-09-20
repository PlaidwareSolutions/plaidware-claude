import { describe, expect, it } from "vitest";
import { auditGroup, auditLabel, describeAudit } from "./kinds";

const fmt = { cents: (c: number) => `$${(c / 100).toFixed(2)}` };

describe("audit kinds", () => {
  it("files platform role changes under the platform group", () => {
    expect(auditGroup("platform_role_changed")).toBe("platform");
    expect(auditLabel("platform_role_changed")).toBe("Platform role changed");
  });
  it("describes a platform role change, noting a sign-out", () => {
    expect(
      describeAudit("platform_role_changed", { targetEmail: "a@x.co", before: "ops_admin", after: "customer", sessionsRevoked: true }, fmt),
    ).toBe("a@x.co: ops admin → customer · signed out");
    expect(
      describeAudit("platform_role_changed", { targetEmail: "a@x.co", before: "customer", after: "ops_admin", sessionsRevoked: false }, fmt),
    ).toBe("a@x.co: customer → ops admin");
  });
  it("describes account disable and re-enable", () => {
    expect(auditGroup("account_disabled")).toBe("platform");
    expect(describeAudit("account_disabled", { targetEmail: "a@x.co", reason: "left the company", sessionsRevoked: 2 }, fmt)).toBe(
      "a@x.co — left the company · 2 sessions revoked",
    );
    expect(describeAudit("account_enabled", { targetEmail: "a@x.co", reason: null, sessionsRevoked: 0 }, fmt)).toBe("a@x.co");
  });
  it("describes session revocation", () => {
    expect(describeAudit("sessions_revoked", { targetEmail: "a@x.co", count: 3, all: true }, fmt)).toBe("a@x.co · all 3 sessions");
    expect(describeAudit("sessions_revoked", { targetEmail: "a@x.co", count: 1, all: false }, fmt)).toBe("a@x.co · one device");
  });
  it("describes an ownership transfer", () => {
    expect(auditGroup("ownership_transferred")).toBe("people");
    expect(describeAudit("ownership_transferred", { fromEmail: "a@x.co", toEmail: "b@x.co" }, fmt)).toBe("a@x.co → b@x.co");
  });
  it("still humanises unknown kinds", () => {
    expect(auditLabel("something_new")).toBe("Something new");
    expect(auditGroup("something_new")).toBe("workspace");
  });
});
