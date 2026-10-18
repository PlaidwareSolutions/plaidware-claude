import { PLATFORM_ROLES, PLATFORM_ROLE_META, isPlatformRole, type PlatformRole } from "../lib/roles";

/**
 * "View as": an ops admin looking at the Hub as another user, read-only.
 * The rules shared by the server policy (src/policy/index.ts), the auth
 * plugin (src/lib/impersonation-plugin.ts), the ops UI and the app shell.
 * Pure: no db, no auth import, so client components and tests can use it.
 */

/** Roles an ops admin may view as — everything below ops admin. */
export const IMPERSONATABLE_PLATFORM_ROLES: readonly PlatformRole[] = PLATFORM_ROLES.filter(
  (r) => PLATFORM_ROLE_META[r].level < PLATFORM_ROLE_META.ops_admin.level,
);

export function isImpersonatableRole(v: unknown): v is PlatformRole {
  return isPlatformRole(v) && IMPERSONATABLE_PLATFORM_ROLES.includes(v);
}

/** The reason an ops admin gives before viewing; kept in the audit row. */
export const IMPERSONATION_REASON_MIN = 3;
export const IMPERSONATION_REASON_MAX = 500;

export type ImpersonationInfo = {
  /** The ops admin really at the keyboard. */
  actorUserId: string;
  /** When the view ends on its own (one hour after it started, never extended). */
  expiresAt: Date;
};

type SessionLike = { session: { impersonatedBy?: string | null; expiresAt: Date | string } } | null | undefined;

/** Who is really at the keyboard when this is a view-as session; null for an ordinary one. */
export function impersonationOf(s: SessionLike): ImpersonationInfo | null {
  const by = s?.session.impersonatedBy;
  if (!s || !by) return null;
  return { actorUserId: by, expiresAt: new Date(s.session.expiresAt) };
}

/** Why a change was refused while viewing as someone. */
export function viewAsMessage(name: string): string {
  return `Read-only while viewing as ${name} — stop viewing to make changes.`;
}
