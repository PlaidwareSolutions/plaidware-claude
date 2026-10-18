import { describe, expect, it } from "vitest";
import { IMPERSONATED_SESSION_ALLOWED_PATHS, isImpersonatedSessionAllowedPath } from "./impersonation-surface";

describe("isImpersonatedSessionAllowedPath", () => {
  it("lets a view-as session read itself, switch workspace, stop and sign out", () => {
    for (const p of ["/get-session", "/sign-out", "/ok", "/error", "/organization/set-active", "/impersonation/stop"]) {
      expect(isImpersonatedSessionAllowedPath(p)).toBe(true);
    }
    expect(IMPERSONATED_SESSION_ALLOWED_PATHS).toHaveLength(6);
  });
  it("refuses every state-changing auth route", () => {
    for (const p of [
      "/change-password",
      "/set-password",
      "/update-user",
      "/update-session",
      "/change-email",
      "/delete-user",
      "/revoke-session",
      "/revoke-sessions",
      "/revoke-other-sessions",
      "/list-sessions",
      "/send-verification-email",
      "/organization/accept-invitation",
      "/organization/create",
      "/sign-in/email",
      "/sign-in/magic-link",
      "/magic-link/verify",
      "/impersonation/start",
    ]) {
      expect(isImpersonatedSessionAllowedPath(p)).toBe(false);
    }
  });
  it("matches exactly, never by prefix, and refuses a missing path", () => {
    expect(isImpersonatedSessionAllowedPath("/get-session-x")).toBe(false);
    expect(isImpersonatedSessionAllowedPath("/organization/set-active/")).toBe(false);
    expect(isImpersonatedSessionAllowedPath("/impersonation/stop-all")).toBe(false);
    expect(isImpersonatedSessionAllowedPath(undefined)).toBe(false);
    expect(isImpersonatedSessionAllowedPath("")).toBe(false);
  });
});
