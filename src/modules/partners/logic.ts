import { createHash } from "node:crypto";

/** Same algorithm as ingest keys: the whole raw key, SHA-256, hex. */
export function hashPartnerKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * A key may read `requestedPrefix` when some allowlist entry equals it or is
 * a prefix of it — a narrower request than the grant is always fine, a
 * broader one never is.
 */
export function partnerKeyAllows(allowlist: string[], requestedPrefix: string): boolean {
  if (!requestedPrefix) return false;
  return allowlist.some((granted) => granted.length > 0 && requestedPrefix.startsWith(granted));
}
