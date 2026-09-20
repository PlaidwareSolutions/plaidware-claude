import { describe, expect, it } from "vitest";
import { ORG_BROWSER_ALLOWLIST, disabledOrgPaths } from "./org-http-surface";

const PATHS = [
  "/organization/create",
  "/organization/delete",
  "/organization/invite-member",
  "/organization/accept-invitation",
  "/organization/leave",
  "/organization/list",
  "/sign-in/email",
  "/get-session",
];

describe("disabledOrgPaths", () => {
  it("disables every organization path except the browser allowlist", () => {
    const out = disabledOrgPaths(PATHS);
    expect(out).toEqual([
      "/organization/create",
      "/organization/delete",
      "/organization/invite-member",
      "/organization/leave",
      "/organization/list",
    ]);
    expect(out).not.toContain("/organization/accept-invitation");
  });
  it("ignores endpoint entries that have no path", () => {
    expect(disabledOrgPaths([undefined, null, 42, "/organization/create"])).toEqual(["/organization/create"]);
  });
  it("never touches non-organization paths", () => {
    expect(disabledOrgPaths(PATHS)).not.toContain("/sign-in/email");
    expect(disabledOrgPaths(["/sign-in/email"])).toEqual([]);
    expect(disabledOrgPaths([])).toEqual([]);
  });
  it("matches the allowlist exactly, not by prefix", () => {
    expect(disabledOrgPaths(["/organization/accept-invitation-x"])).toEqual([
      "/organization/accept-invitation-x",
    ]);
  });
  it("dedupes and only allowlists accept-invitation", () => {
    expect(ORG_BROWSER_ALLOWLIST).toEqual(["/organization/accept-invitation"]);
    expect(disabledOrgPaths(["/organization/create", "/organization/create"])).toEqual([
      "/organization/create",
    ]);
  });
});
