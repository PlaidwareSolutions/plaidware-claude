export type ClientTab = "billing" | "provisioning" | "monitoring" | "people" | "activity";

/**
 * Every internal path, in one place — used for <Link href> and for
 * revalidatePath alike, so a route move is a one-file change and a
 * revalidation can never target a path that no longer exists.
 */
export const OPS = {
  home: "/ops",
  clients: "/ops/clients",
  client: (id: string) => `/ops/clients/${id}`,
  clientTab: (id: string, tab: ClientTab) => `/ops/clients/${id}/${tab}`,
  clientNew: "/ops/clients/new",
  billing: "/ops/billing",
  subscriptions: "/ops/billing/subscriptions",
  products: "/ops/products",
  product: (id: string) => `/ops/products/${id}`,
  monitoring: "/ops/monitoring",
  inbox: "/ops/inbox",
  leads: "/ops/inbox/leads",
  system: "/ops/system",
  access: "/ops/system/access",
  webhooks: "/ops/system/webhooks",
  costs: "/ops/system/costs",
  promos: "/ops/system/promos",
} as const;

export const TENANT = {
  dashboard: "/dashboard",
  billing: "/billing",
  monitoring: "/monitoring",
  inbox: "/inbox",
  team: "/team",
  settings: "/settings",
  checkout: "/checkout",
} as const;

export const AUTH = {
  login: "/login",
  signup: "/signup",
  welcome: (token: string) => `/welcome/${token}`,
} as const;

/** `withQuery(OPS.monitoring, { tenant: id })` → "/ops/monitoring?tenant=…"; empty values are dropped. */
export function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

const STRIPE = "https://dashboard.stripe.com";
export function stripeCustomerUrl(customerId: string, testMode = false): string {
  return `${STRIPE}${testMode ? "/test" : ""}/customers/${customerId}`;
}
export function stripeSubscriptionUrl(subscriptionId: string, testMode = false): string {
  return `${STRIPE}${testMode ? "/test" : ""}/subscriptions/${subscriptionId}`;
}
export function stripeInvoiceUrl(invoiceId: string, testMode = false): string {
  return `${STRIPE}${testMode ? "/test" : ""}/invoices/${invoiceId}`;
}
