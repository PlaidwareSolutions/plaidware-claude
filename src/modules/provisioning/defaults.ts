import { env } from "../../env";

export type DnsDefaults = { expectedCname: string | null; expectedAIps: string | null };

/**
 * Where a new provisioning row's DNS targets come from: the product's own
 * defaults (Phase 3 columns) first, then the platform env fallback, else blank
 * (the token-only TXT check still works).
 */
export function resolveDnsDefaults(
  product?: { defaultExpectedCname?: string | null; defaultExpectedAIps?: string | null } | null,
  fallback: { cname?: string | null; aIps?: string | null } = {
    cname: env.PROVISIONING_DEFAULT_CNAME,
    aIps: env.PROVISIONING_DEFAULT_A_IPS,
  },
): DnsDefaults {
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    expectedCname: clean(product?.defaultExpectedCname) ?? clean(fallback.cname),
    expectedAIps: clean(product?.defaultExpectedAIps) ?? clean(fallback.aIps),
  };
}
