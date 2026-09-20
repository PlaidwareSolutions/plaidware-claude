import { TENANT } from "./routes";

/**
 * Post-auth redirect targets arrive via a query param, so they are
 * attacker-controllable. Only same-app paths and https plaidware.com
 * (sub)domain URLs (the MHub cross-app hand-off) are honored.
 */
export function resolveRedirect(raw: string | null): { url: string; external: boolean } {
  const fallback = { url: TENANT.dashboard, external: false };
  if (!raw) return fallback;
  if (raw.startsWith("/") && !raw.startsWith("//")) return { url: raw, external: false };
  try {
    const u = new URL(raw);
    if (
      u.protocol === "https:" &&
      (u.hostname === "plaidware.com" || u.hostname.endsWith(".plaidware.com"))
    ) {
      return { url: u.toString(), external: true };
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}
