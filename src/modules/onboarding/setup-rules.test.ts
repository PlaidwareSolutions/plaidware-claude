import { describe, expect, it } from "vitest";
import { needsPasswordSetup } from "./setup-rules";

describe("needsPasswordSetup", () => {
  it("is true until both a password and a verified email exist", () => {
    expect(needsPasswordSetup({ emailVerified: false, credentialPassword: undefined })).toBe(true); // fresh ops row
    expect(needsPasswordSetup({ emailVerified: true, credentialPassword: null })).toBe(true); // magic-link first
    expect(needsPasswordSetup({ emailVerified: false, credentialPassword: "$hash" })).toBe(true); // legacy throwaway
    expect(needsPasswordSetup({ emailVerified: true, credentialPassword: "$hash" })).toBe(false); // done
  });
});
