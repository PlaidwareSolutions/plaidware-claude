import { tenantStatusAllows, tenantStatusMessage } from "./tenant-status";

/**
 * Rules Better Auth's organization routes must honour even when a caller
 * skips src/policy (defense in depth behind src/lib/auth.ts before-hooks):
 *
 *   - the owner role is never granted directly; it moves by transfer
 *     (PRD §4.2: exactly one owner per tenant)
 *   - an owner membership is never edited or removed
 *   - a suspended or inactive workspace accepts no team changes
 *
 * Ops paths in src/modules/tenancy/service.ts write directly and are not
 * subject to these hooks — ops must be able to act on suspended tenants.
 */
export type OrgMutation = "invite" | "add" | "accept" | "update-role" | "remove";

export const OWNER_ROLE_MESSAGE = "The owner role is assigned by transferring ownership.";

const hasOwner = (role: string | null | undefined) =>
  !!role && role.split(",").map((r) => r.trim()).includes("owner");

/** Null when the mutation may proceed, otherwise the sentence to show. */
export function orgMutationBlockReason(
  kind: OrgMutation,
  org: { status?: string | null },
  target: { role?: string | null; newRole?: string | null } = {},
): string | null {
  // The role being granted: invite/accept carry it in `role`, update-role in
  // `newRole`. `add` is exempt — the creator membership of a new org goes
  // through it with the creator role — and `remove` grants nothing.
  const granted = kind === "update-role" ? target.newRole : kind === "invite" || kind === "accept" ? target.role : null;
  if (hasOwner(granted)) return OWNER_ROLE_MESSAGE;
  if (kind === "update-role" && hasOwner(target.role)) {
    return "The owner can't be given a different role. Transfer ownership first.";
  }
  if (kind === "remove" && hasOwner(target.role)) {
    return "The owner can't be removed. Transfer ownership first.";
  }
  if (!tenantStatusAllows(org.status, "team")) return tenantStatusMessage(org.status);
  return null;
}
