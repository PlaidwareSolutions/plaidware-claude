import { PLATFORM_ROLE_META, isDowngrade, type PlatformRole } from "@/lib/roles";

/**
 * Who may change whose platform role, and how the change is confirmed.
 * Pure so the Access table can pre-validate and the service can enforce.
 */

/** Roles the Access tab can assign. */
export const GRANTABLE_PLATFORM_ROLES = ["customer", "developer", "ops_support", "ops_admin"] as const satisfies readonly PlatformRole[];

/** Roles a staff account can be created with (every role that grants something). */
export const STAFF_ROLES = ["developer", "ops_support", "ops_admin"] as const satisfies readonly PlatformRole[];
export type StaffRole = (typeof STAFF_ROLES)[number];
export function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === "string" && (STAFF_ROLES as readonly string[]).includes(v);
}

export type PlatformRoleChange = {
  /** Null for the bootstrap script: no self or last-admin guard applies. */
  actorUserId: string | null;
  targetUserId: string;
  targetEmailVerified: boolean;
  current: PlatformRole;
  next: PlatformRole;
  /** How many ops admins exist right now (the target included). */
  opsAdminCount: number;
};

export type RuleVerdict = { ok: true } | { ok: false; reason: string };

const label = (r: PlatformRole) => PLATFORM_ROLE_META[r].label;

export function canChangePlatformRole(i: PlatformRoleChange): RuleVerdict {
  if (i.current === i.next) return { ok: false, reason: `Already ${label(i.current)}.` };
  if (i.actorUserId !== null && i.actorUserId === i.targetUserId) {
    return { ok: false, reason: "You can't change your own platform role. Ask another ops admin." };
  }
  if (i.next !== "customer" && !i.targetEmailVerified) {
    return { ok: false, reason: "Staff roles need a verified email address." };
  }
  if (i.current === "ops_admin" && i.next !== "ops_admin" && i.opsAdminCount <= 1) {
    return { ok: false, reason: "This is the last ops admin. Grant someone else ops admin first." };
  }
  return { ok: true };
}

export type PlatformRoleConfirm = {
  title: string;
  description: string;
  destructive: boolean;
  /** Ask the actor to type the target's email (any change touching ops admin). */
  typedEmail: boolean;
};

export function platformRoleChangeConfirm(i: {
  before: PlatformRole;
  after: PlatformRole;
  name: string;
  email: string;
}): PlatformRoleConfirm {
  const destructive = isDowngrade(i.before, i.after);
  const typedEmail = i.before === "ops_admin" || i.after === "ops_admin";
  return destructive
    ? {
        title: `Revoke ${label(i.before)} from ${i.name}?`,
        description: `${i.email} becomes ${label(i.after)} and is signed out everywhere.`,
        destructive,
        typedEmail,
      }
    : {
        title: `Make ${i.name} ${label(i.after)}?`,
        description: `${i.email} becomes ${label(i.after)}: ${PLATFORM_ROLE_META[i.after].description.toLowerCase()}.`,
        destructive,
        typedEmail,
      };
}

// ---------------------------------------------------------------------------
// Account lifecycle
// ---------------------------------------------------------------------------

export type AccountDisableChange = {
  /** Null for a script: no self guard applies. */
  actorUserId: string | null;
  targetUserId: string;
  targetRole: PlatformRole;
  currentlyDisabled: boolean;
  disabled: boolean;
  /** Ops admins that are currently active (the target included when it is one). */
  activeOpsAdminCount: number;
};

export function canSetAccountDisabled(i: AccountDisableChange): RuleVerdict {
  if (i.actorUserId !== null && i.actorUserId === i.targetUserId) {
    return { ok: false, reason: "You can't disable your own account. Ask another ops admin." };
  }
  if (i.currentlyDisabled === i.disabled) {
    return { ok: false, reason: i.disabled ? "Already disabled." : "Already active." };
  }
  if (i.disabled && i.targetRole === "ops_admin" && i.activeOpsAdminCount <= 1) {
    return { ok: false, reason: "This is the last active ops admin. Grant someone else ops admin first." };
  }
  return { ok: true };
}

export function accountDisableConfirm(i: {
  name: string;
  email: string;
  role: PlatformRole;
  disabled: boolean;
}): PlatformRoleConfirm {
  return i.disabled
    ? {
        title: `Disable ${i.name}'s account?`,
        description: `${i.email} is signed out everywhere and can't sign in, request a magic link or reset a password until re-enabled. Workspaces, roles and history are kept.`,
        destructive: true,
        typedEmail: i.role !== "customer",
      }
    : {
        title: `Re-enable ${i.name}'s account?`,
        description: `${i.email} can sign in again with their existing password or a magic link.`,
        destructive: false,
        typedEmail: false,
      };
}

/** Ops may sign a person out of one device — never the device the actor is using right now. */
export function canRevokeSession(i: { actorUserId: string; targetUserId: string; sessionId: string; currentSessionId: string }): RuleVerdict {
  if (i.actorUserId === i.targetUserId && i.sessionId === i.currentSessionId) {
    return { ok: false, reason: "That's the session you're using — sign out instead." };
  }
  return { ok: true };
}

/** Signing yourself out everywhere is Sign out's job, not an ops action. */
export function canRevokeAllSessions(i: { actorUserId: string; targetUserId: string }): RuleVerdict {
  if (i.actorUserId === i.targetUserId) return { ok: false, reason: "Use Sign out to end your own sessions." };
  return { ok: true };
}

export function canSendPasswordSetup(i: { targetDisabled: boolean }): RuleVerdict {
  if (i.targetDisabled) return { ok: false, reason: "This account is disabled. Re-enable it first." };
  return { ok: true };
}

export function typedEmailMatches(value: string | undefined, email: string): boolean {
  return (value ?? "").trim().toLowerCase() === email.trim().toLowerCase();
}
