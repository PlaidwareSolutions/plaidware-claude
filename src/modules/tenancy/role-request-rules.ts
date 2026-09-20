import { TENANT_ROLE_META, isAssignableTenantRole, isTenantRole, tenantRoleCaps } from "@/lib/roles";
import { normalizeTenantStatus, tenantStatusAllows, tenantStatusMessage } from "@/policy/tenant-status";

/**
 * The decisions behind self-service role requests. Pure: the Team page
 * pre-validates with these and the service enforces them.
 */
export type Verdict = { ok: true } | { ok: false; reason: string };

const ok: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });
export const roleLabel = (r: string) => (isTenantRole(r) ? TENANT_ROLE_META[r].label : r);

/**
 * Members without team rights (billing, member) may ask. A suspended
 * workspace still may — the common case is a member who needs billing to
 * pay the invoice that caused the suspension. An inactive one may not.
 */
export function canRequestRoleChange(i: { role: string; tenantStatus: string | null | undefined }): Verdict {
  if (i.role === "ops") return no("Ops accounts don't hold workspace roles.");
  if (tenantRoleCaps(i.role).has("team")) return no("Your role already manages the team.");
  if (normalizeTenantStatus(i.tenantStatus) === "inactive") return no(tenantStatusMessage(i.tenantStatus));
  return ok;
}

export function canRequestRole(i: { currentRole: string; requestedRole: string }): Verdict {
  if (!isAssignableTenantRole(i.requestedRole)) return no("That role can't be requested.");
  if (i.requestedRole === i.currentRole) return no(`You're already ${roleLabel(i.currentRole)}.`);
  return ok;
}

/** Owners/admins of an active workspace, or ops in any status; never the requester. */
export function canDecideRoleRequest(i: {
  deciderRole: string;
  deciderUserId: string;
  requesterUserId: string;
  tenantStatus: string | null | undefined;
}): Verdict {
  if (i.deciderUserId === i.requesterUserId) return no("You can't decide your own request.");
  if (i.deciderRole === "ops") return ok;
  if (!tenantRoleCaps(i.deciderRole).has("team")) return no("Only owners and admins decide role requests.");
  if (!tenantStatusAllows(i.tenantStatus, "team")) return no(tenantStatusMessage(i.tenantStatus));
  return ok;
}

/** The requester withdraws; a decider or ops dismisses (silently, unlike a decline). */
export function canCancelRoleRequest(i: { actorUserId: string; actorRole: string; requesterUserId: string }): Verdict {
  if (i.actorRole === "ops" || i.actorUserId === i.requesterUserId) return ok;
  if (tenantRoleCaps(i.actorRole).has("team")) return ok;
  return no("Only the requester or a workspace admin can withdraw a request.");
}

/** The member's role changed by other means since they asked. */
export function isRoleRequestStale(i: { currentRole: string; liveRole: string }): boolean {
  return i.currentRole !== i.liveRole;
}

/** Who gets the "please review" email: everyone with team rights. */
export function roleRequestDeciders<T extends { role: string }>(members: readonly T[]): T[] {
  return members.filter((m) => tenantRoleCaps(m.role).has("team"));
}

const NUDGE_AFTER_DAYS = 3;

/** Requests waiting more than a few days turn into a warning on the ops overview. */
export function roleRequestAttentionTone(createdAt: Date | string, now: Date = new Date()): "info" | "warning" {
  const age = now.getTime() - new Date(createdAt).getTime();
  return age > NUDGE_AFTER_DAYS * 86_400_000 ? "warning" : "info";
}
