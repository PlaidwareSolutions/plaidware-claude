import { PLATFORM_ROLE_META, isDowngrade, type PlatformRole } from "@/lib/roles";

/**
 * Who may change whose platform role, and how the change is confirmed.
 * Pure so the Access table can pre-validate and the service can enforce.
 */

/** Roles the Access tab can assign. ops_support joins once policy honours it. */
export const GRANTABLE_PLATFORM_ROLES = ["customer", "ops_admin"] as const satisfies readonly PlatformRole[];

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
    return { ok: false, reason: "Ops roles need a verified email address." };
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

export function typedEmailMatches(value: string | undefined, email: string): boolean {
  return (value ?? "").trim().toLowerCase() === email.trim().toLowerCase();
}
