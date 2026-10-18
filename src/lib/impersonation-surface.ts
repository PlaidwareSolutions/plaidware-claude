/**
 * Which Better Auth paths a view-as (impersonated) session may still call.
 * Everything else — password and email changes, session revocation,
 * accepting invitations, signing in as someone else, the raw
 * update-session route — is refused by the impersonation plugin's
 * before-hook (src/lib/impersonation-plugin.ts), over HTTP and via
 * auth.api alike. Default deny: a new Better Auth route is closed until
 * it is listed here on purpose.
 */
export const IMPERSONATED_SESSION_ALLOWED_PATHS: readonly string[] = [
  // The Hub's own reads (src/policy getSession) and MHub's session introspection.
  "/get-session",
  // Leaving the view the hard way; the plugin's after-hook cleans up the admin's stash.
  "/sign-out",
  "/ok",
  "/error",
  // Switching the active workspace is a read: setActiveTenantAction reaches this via auth.api.
  "/organization/set-active",
  // The way back to the admin's own session.
  "/impersonation/stop",
];

export function isImpersonatedSessionAllowedPath(path: string | undefined): boolean {
  return typeof path === "string" && IMPERSONATED_SESSION_ALLOWED_PATHS.includes(path);
}
