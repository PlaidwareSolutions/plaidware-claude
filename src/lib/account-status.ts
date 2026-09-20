/**
 * Account lifecycle, independent of roles: a disabled account keeps its
 * data and memberships but cannot sign in (sessions are revoked, password
 * resets and magic links refused). Pure and client-safe.
 */
export const ACCOUNT_DISABLED_CODE = "ACCOUNT_DISABLED";
export const ACCOUNT_DISABLED_MESSAGE =
  "This account has been disabled. Contact Plaidware if you think this is a mistake.";

export type AccountStatus = "active" | "disabled";

export function accountStatusOf(disabledAt: Date | string | null | undefined): AccountStatus {
  return disabledAt ? "disabled" : "active";
}
