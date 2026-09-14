/**
 * Pure cost attribution for one month. A hosted app's cost goes:
 *   - wholly to the subscription it is dedicated to (link.subscriptionId), or
 *   - split evenly across the live subscriptions of every product it is
 *     linked to (product-scoped links), so shared infrastructure spreads.
 */
export type AttributionInput = {
  apps: { id: string; label: string; costCents: number | null }[];
  links: { hostedAppId: string; productId: string; subscriptionId: string | null }[];
  subscriptions: { id: string; tenantId: string; productId: string }[];
};

export type TenantAttribution = {
  tenantId: string;
  costCents: number;
  apps: { hostedAppId: string; label: string; costCents: number; basis: "dedicated" | "shared"; share: number }[];
};

export function attributeTenantCosts(input: AttributionInput): Map<string, TenantAttribution> {
  const out = new Map<string, TenantAttribution>();
  const add = (tenantId: string, app: TenantAttribution["apps"][number]) => {
    const cur = out.get(tenantId) ?? { tenantId, costCents: 0, apps: [] };
    cur.costCents += app.costCents;
    cur.apps.push(app);
    out.set(tenantId, cur);
  };
  const subById = new Map(input.subscriptions.map((s) => [s.id, s]));

  for (const app of input.apps) {
    if (app.costCents == null || app.costCents === 0) continue;
    const links = input.links.filter((l) => l.hostedAppId === app.id);
    const dedicated = links.filter((l) => l.subscriptionId);
    if (dedicated.length) {
      const per = Math.round(app.costCents / dedicated.length);
      for (const l of dedicated) {
        const sub = subById.get(l.subscriptionId!);
        if (sub) add(sub.tenantId, { hostedAppId: app.id, label: app.label, costCents: per, basis: "dedicated", share: 1 / dedicated.length });
      }
      continue;
    }
    const productIds = new Set(links.map((l) => l.productId));
    const targets = input.subscriptions.filter((s) => productIds.has(s.productId));
    if (targets.length === 0) continue;
    const per = Math.round(app.costCents / targets.length);
    for (const s of targets) {
      add(s.tenantId, { hostedAppId: app.id, label: app.label, costCents: per, basis: "shared", share: 1 / targets.length });
    }
  }
  return out;
}
