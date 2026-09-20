/**
 * Which screen an invitation link should show, from facts the server has:
 * the row's status and expiry, the invited address, and the visitor's
 * session (if any). Pure, so the page stays a thin switch.
 */
export type InviteState = "handled" | "expired" | "signed_out" | "mismatch" | "unverified" | "ready";

export function inviteState(i: {
  status: string;
  expiresAt: Date | string;
  invitedEmail: string;
  sessionEmail: string | null;
  sessionEmailVerified?: boolean;
  now?: Date;
}): InviteState {
  if (i.status !== "pending") return "handled";
  if (new Date(i.expiresAt).getTime() <= (i.now ?? new Date()).getTime()) return "expired";
  if (!i.sessionEmail) return "signed_out";
  if (i.sessionEmail.trim().toLowerCase() !== i.invitedEmail.trim().toLowerCase()) return "mismatch";
  if (i.sessionEmailVerified === false) return "unverified";
  return "ready";
}
