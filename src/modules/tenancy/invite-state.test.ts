import { describe, expect, it } from "vitest";
import { inviteState } from "./invite-state";

const now = new Date("2026-09-20T12:00:00Z");
const base = { status: "pending", expiresAt: "2026-09-27T12:00:00Z", invitedEmail: "ann@x.com", sessionEmail: null, now };

describe("inviteState", () => {
  it("walks the states in precedence order", () => {
    expect(inviteState({ ...base, status: "accepted", sessionEmail: "ann@x.com" })).toBe("handled");
    expect(inviteState({ ...base, status: "canceled" })).toBe("handled");
    expect(inviteState({ ...base, expiresAt: "2026-09-19T12:00:00Z", sessionEmail: "bob@x.com" })).toBe("expired");
    expect(inviteState(base)).toBe("signed_out");
    expect(inviteState({ ...base, sessionEmail: "bob@x.com" })).toBe("mismatch");
    expect(inviteState({ ...base, sessionEmail: "ann@x.com", sessionEmailVerified: false })).toBe("unverified");
    expect(inviteState({ ...base, sessionEmail: "ann@x.com" })).toBe("ready");
  });
  it("matches emails case-insensitively and trimmed", () => {
    expect(inviteState({ ...base, sessionEmail: " Ann@X.com " })).toBe("ready");
  });
  it("accepts Date objects and treats the exact expiry instant as expired", () => {
    expect(inviteState({ ...base, expiresAt: new Date("2026-09-20T12:00:00Z") })).toBe("expired");
    expect(inviteState({ ...base, expiresAt: new Date("2026-09-20T12:00:01Z") })).toBe("signed_out");
  });
});
