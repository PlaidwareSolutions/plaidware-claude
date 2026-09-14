export type DnsDefaults = { expectedCname: string | null; expectedAIps: string | null };

/**
 * Where a new provisioning row's DNS targets come from: the product's own
 * defaults (Phase 3 columns) first, then the platform env fallback, else blank
 * (the token-only TXT check still works).
 */
export function resolveDnsDefaults(
  product?: { defaultExpectedCname?: string | null; defaultExpectedAIps?: string | null } | null,
  // Read from process.env directly (not src/env) so this stays importable in
  // pure tests; both vars are optional strings and need no validation.
  fallback: { cname?: string | null; aIps?: string | null } = {
    cname: process.env.PROVISIONING_DEFAULT_CNAME,
    aIps: process.env.PROVISIONING_DEFAULT_A_IPS,
  },
): DnsDefaults {
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    expectedCname: clean(product?.defaultExpectedCname) ?? clean(fallback.cname),
    expectedAIps: clean(product?.defaultExpectedAIps) ?? clean(fallback.aIps),
  };
}
