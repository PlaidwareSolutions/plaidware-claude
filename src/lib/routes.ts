export type ClientTab = "billing" | "provisioning" | "monitoring" | "people" | "activity";
export type ProductTab = "pricing" | "kpis" | "defaults" | "subscribers";
export type WorkTab = "backlog" | "sprints" | "settings";
export type UserTab = "workspaces" | "sessions" | "activity";

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
  productTab: (id: string, tab: ProductTab) => `/ops/products/${id}/${tab}`,
  monitoring: "/ops/monitoring",
  inbox: "/ops/inbox",
  leads: "/ops/inbox/leads",
  system: "/ops/system",
  access: "/ops/system/access",
  /** One account: profile, workspaces, sessions, activity (the Access tab is the index). */
  user: (id: string) => `/ops/users/${id}`,
  userTab: (id: string, tab: UserTab) => `/ops/users/${id}/${tab}`,
  roles: "/ops/system/roles",
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
  /** Where a confirmed email change lands (the page turns the query into a toast). */
  settingsAfterEmailChange: () => withQuery("/settings", { email: "changed" }),
  checkout: "/checkout",
  /** Checkout for one product, in the session's active workspace. */
  checkoutFor: (slug: string) => withQuery("/checkout", { product: slug }),
  checkoutComplete: (subscriptionId: string) =>
    withQuery("/checkout/complete", { subscription: subscriptionId }),
} as const;

/**
 * The work area (development queues, boards, sprints) — developers' whole Hub,
 * also reachable by ops. Boards are addressed by product slug, items by their
 * per-board number, so a key-prefix change never breaks a link. `/work/my` is
 * a static segment: a product with slug "my" would be shadowed.
 */
export const WORK = {
  home: "/work",
  my: "/work/my",
  board: (slug: string) => `/work/${slug}`,
  tab: (slug: string, tab: WorkTab) => `/work/${slug}/${tab}`,
  backlog: (slug: string) => `/work/${slug}/backlog`,
  sprints: (slug: string) => `/work/${slug}/sprints`,
  sprint: (slug: string, id: string) => `/work/${slug}/sprints/${id}`,
  item: (slug: string, number: number) => `/work/${slug}/items/${number}`,
  settings: (slug: string) => `/work/${slug}/settings`,
} as const;

export const AUTH = {
  login: "/login",
  signup: "/signup",
  checkEmail: "/check-email",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  invite: (id: string) => `/invite/${id}`,
  welcome: (token: string) => `/welcome/${token}`,
} as const;

/**
 * Marketing routes, served by plaidware.com. On the hub host src/proxy.ts
 * bounces them to the marketing site, so a link to one leaves the app —
 * keep the constant, never turn it into an app route.
 */
export const MARKETING = {
  products: "/products",
  product: (slug: string) => `/products/${slug}`,
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
