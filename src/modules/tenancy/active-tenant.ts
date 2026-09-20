/**
 * The workspace a session is acting in: the session's active organization
 * while the user is still a member of it, otherwise their first workspace
 * (a stale activeOrganizationId survives leaving a workspace).
 */
export function pickActiveTenant<T extends { id: string }>(
  tenants: readonly T[],
  activeOrganizationId: string | null | undefined,
): T | null {
  return tenants.find((t) => t.id === activeOrganizationId) ?? tenants[0] ?? null;
}
