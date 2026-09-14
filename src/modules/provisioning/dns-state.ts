/**
 * One derived state per provisioned subscription, so every badge and
 * attention item reads the same word for the same facts.
 */
export type DnsState =
  | "no_domain"
  | "unconfigured"
  | "configured"
  | "verified"
  | "failing"
  | "handshake_pending"
  | "provisioned";

export function deriveDnsState(p: {
  managedByPartner: boolean;
  domainUrl: string | null;
  hasVerifyToken: boolean;
  expectedCname: string | null;
  expectedAIps: string | null;
  dnsLastOk: boolean | null;
}): DnsState {
  if (p.managedByPartner) return p.domainUrl ? "provisioned" : "handshake_pending";
  if (!p.domainUrl) return "no_domain";
  if (p.dnsLastOk === true) return "verified";
  if (p.dnsLastOk === false) return "failing";
  return p.hasVerifyToken || p.expectedCname || p.expectedAIps ? "configured" : "unconfigured";
}
