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

export type DnsRecord = { type: "TXT" | "CNAME" | "A"; host: string; value: string; note?: string };

/** The records a client's DNS provider needs, in the order they should add them. */
export function buildDnsRecords(p: {
  host: string;
  verifyToken: string | null;
  expectedCname: string | null;
  expectedAIps: string | null;
}): DnsRecord[] {
  const out: DnsRecord[] = [];
  if (p.verifyToken) {
    out.push({ type: "TXT", host: p.host, value: `plaidware-verify=${p.verifyToken}`, note: "proves ownership" });
  }
  if (p.expectedCname) {
    out.push({ type: "CNAME", host: p.host, value: p.expectedCname, note: "routes the site (preferred)" });
  }
  for (const ip of (p.expectedAIps ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    out.push({ type: "A", host: p.host, value: ip, note: p.expectedCname ? "alternative to the CNAME" : "routes the site" });
  }
  return out;
}
