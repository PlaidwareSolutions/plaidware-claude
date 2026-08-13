/**
 * Domain ownership/routing verification (PRD §4.7) with configurable targets —
 * the legacy hard-coded Replit edge IP is gone. Resolver is injectable for tests.
 */

export type DnsResolver = {
  resolveTxt(host: string): Promise<string[][]>;
  resolveCname(host: string): Promise<string[]>;
  resolve4(host: string): Promise<string[]>;
};

export type VerifyConfig = {
  domainUrl: string;
  /** TXT mode (primary): DNS must carry `plaidware-verify=<token>`. */
  verifyToken?: string | null;
  /** Routing mode fallbacks. */
  expectedCname?: string | null;
  expectedAIps?: string[] | null;
};

export type VerifyResult = {
  ok: boolean;
  mode: "txt" | "cname" | "a-record" | "unconfigured";
  resolved: string[];
  detail: string;
};

export function hostFromUrl(domainUrl: string): string {
  try {
    return new URL(domainUrl.includes("://") ? domainUrl : `https://${domainUrl}`).hostname;
  } catch {
    return domainUrl;
  }
}

export async function verifyDomain(
  config: VerifyConfig,
  resolver: DnsResolver,
): Promise<VerifyResult> {
  const host = hostFromUrl(config.domainUrl);

  if (config.verifyToken) {
    const expected = `plaidware-verify=${config.verifyToken}`.toLowerCase();
    let records: string[] = [];
    try {
      records = (await resolver.resolveTxt(host)).map((chunks) => chunks.join(""));
    } catch {
      /* fall through with empty records */
    }
    const ok = records.some((r) => r.toLowerCase().includes(expected));
    return {
      ok,
      mode: "txt",
      resolved: records,
      detail: ok
        ? `TXT record carries plaidware-verify token`
        : `No TXT record with plaidware-verify=<token> found on ${host}`,
    };
  }

  if (config.expectedCname) {
    let cnames: string[] = [];
    try {
      cnames = await resolver.resolveCname(host);
    } catch {
      /* fall through */
    }
    const want = config.expectedCname.toLowerCase().replace(/\.$/, "");
    const ok = cnames.some((c) => c.toLowerCase().replace(/\.$/, "") === want);
    return {
      ok,
      mode: "cname",
      resolved: cnames,
      detail: ok ? `CNAME points at ${want}` : `CNAME does not point at ${want}`,
    };
  }

  if (config.expectedAIps?.length) {
    let ips: string[] = [];
    try {
      ips = await resolver.resolve4(host);
    } catch {
      /* fall through */
    }
    const allow = new Set(config.expectedAIps.map((ip) => ip.trim()));
    const ok = ips.some((ip) => allow.has(ip));
    return {
      ok,
      mode: "a-record",
      resolved: ips,
      detail: ok ? `A record resolves into the allow-list` : `A records not in the allow-list`,
    };
  }

  return {
    ok: false,
    mode: "unconfigured",
    resolved: [],
    detail: "Set a verify token, expected CNAME, or A-record allow-list first",
  };
}
