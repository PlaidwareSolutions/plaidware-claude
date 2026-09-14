import { describe, expect, it } from "vitest";
import { recheckAllowed } from "./recheck";

const now = new Date("2026-09-14T12:00:00Z");

describe("recheckAllowed", () => {
  it("allows the first audit and anything past the cooldown", () => {
    expect(recheckAllowed(null, now)).toEqual({ allowed: true });
    expect(recheckAllowed("2026-09-14T11:58:00Z", now)).toEqual({ allowed: true });
  });
  it("blocks inside the cooldown with a retry hint", () => {
    expect(recheckAllowed("2026-09-14T11:59:30Z", now)).toEqual({ allowed: false, retryInSeconds: 30 });
  });
});
