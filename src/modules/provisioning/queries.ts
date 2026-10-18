import { inArray } from "drizzle-orm";
import { db } from "../../db";
import { loadPartnerDirectory } from "../partners/targets";
import { provisioningCredentials, subscriptionProvisioning } from "./schema";
import { deriveDnsState, type DnsState } from "./dns-state";

export type ProvisioningView = {
  subscriptionId: string;
  productId: string;
  productName: string;
  /** Partner-app products (MHub, Fixorata…): the partner owns the URL via the provisioning handshake — no DNS controls. */
  managedByPartner: boolean;
  partnerName: string | null;
  domainUrl: string | null;
  hasVerifyToken: boolean;
  verifyToken: string | null;
  expectedCname: string | null;
  expectedAIps: string | null;
  dnsLastOk: boolean | null;
  dnsLastVerifiedAt: string | null;
  dnsLastResolved: string | null;
  state: DnsState;
  credentials: {
    id: string;
    kind: string;
    label: string;
    url: string | null;
    username: string | null;
    hasSecret: boolean;
  }[];
};

const CLOSED = new Set(["canceled", "expired"]);

/** Provisioning rows + stored credentials for a client's open subscriptions. */
export async function listTenantProvisioning(
  subscriptions: { id: string; productId: string; productName: string; productSlug: string; status: string }[],
): Promise<ProvisioningView[]> {
  const open = subscriptions.filter((s) => !CLOSED.has(s.status));
  if (open.length === 0) return [];
  const ids = open.map((s) => s.id);
  const [provRows, credRows, partnerOf] = await Promise.all([
    db.query.subscriptionProvisioning.findMany({
      where: inArray(subscriptionProvisioning.subscriptionId, ids),
    }),
    db.query.provisioningCredentials.findMany({
      where: inArray(provisioningCredentials.subscriptionId, ids),
    }),
    loadPartnerDirectory(),
  ]);

  return open.map((s) => {
    const p = provRows.find((x) => x.subscriptionId === s.id);
    const partner = partnerOf(s.productSlug);
    const facts = {
      managedByPartner: partner != null,
      domainUrl: p?.domainUrl ?? null,
      hasVerifyToken: Boolean(p?.verifyToken),
      expectedCname: p?.expectedCname ?? null,
      expectedAIps: p?.expectedAIps ?? null,
      dnsLastOk: p?.dnsLastOk ?? null,
    };
    return {
      subscriptionId: s.id,
      productId: s.productId,
      productName: s.productName,
      partnerName: partner?.displayName ?? null,
      ...facts,
      verifyToken: p?.verifyToken ?? null,
      dnsLastVerifiedAt: p?.dnsLastVerifiedAt?.toISOString() ?? null,
      dnsLastResolved: p?.dnsLastResolved ?? null,
      state: deriveDnsState(facts),
      credentials: credRows
        .filter((c) => c.subscriptionId === s.id)
        .map((c) => ({
          id: c.id,
          kind: c.kind,
          label: c.label,
          url: c.url,
          username: c.username,
          hasSecret: Boolean(c.secretCiphertext),
        })),
    };
  });
}
