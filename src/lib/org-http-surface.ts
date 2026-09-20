/**
 * Which Better Auth organization endpoints the browser may call.
 *
 * The organization plugin mounts every org mutation under
 * /api/auth/organization/* with its own permission model, not src/policy.
 * The Hub drives those mutations server-side through `auth.api.*` (which
 * bypasses the HTTP router, so `disabledPaths` never affects it) and only
 * needs one endpoint reachable from the browser: accepting an invitation.
 * Everything else is 404 over HTTP so the tenant-status gate, the unique
 * owner rule, audit and MHub emits cannot be sidestepped.
 */
export const ORG_BROWSER_ALLOWLIST: readonly string[] = ["/organization/accept-invitation"];

/**
 * The `/organization/*` paths to hand to Better Auth's `disabledPaths`.
 * Accepts the plugin's raw endpoint paths, some of which are not strings
 * (helper entries without a route), and ignores those.
 */
export function disabledOrgPaths(paths: readonly unknown[]): string[] {
  const disabled = new Set<string>();
  for (const p of paths) {
    if (typeof p !== "string") continue;
    if (p.startsWith("/organization/") && !ORG_BROWSER_ALLOWLIST.includes(p)) disabled.add(p);
  }
  return [...disabled].sort();
}
