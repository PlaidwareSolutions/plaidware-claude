/**
 * The single status → badge-variant map. Every status pill in both portals
 * goes through statusVariant(); no component picks a colour on its own.
 */
import { PLATFORM_ROLES, PLATFORM_ROLE_META, TENANT_ROLES, TENANT_ROLE_META } from "./roles";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning";

export type StatusKind =
  | "tenant"
  | "subscription"
  | "subscriptionItem"
  | "invoice"
  | "dunning"
  | "health"
  | "dns"
  | "webhook"
  | "contact"
  | "thread"
  | "collection"
  | "product"
  | "promo"
  | "tenantRole"
  | "platformRole"
  | "verification"
  | "invite"
  | "roleRequest"
  | "workItem"
  | "workType"
  | "workPriority"
  | "sprint";

type Entry = { variant: BadgeVariant; label?: string };

const MAP: Record<StatusKind, Record<string, Entry>> = {
  tenant: {
    active: { variant: "success" },
    suspended: { variant: "destructive" },
    inactive: { variant: "outline" },
  },
  subscription: {
    active: { variant: "success" },
    trialing: { variant: "outline" },
    incomplete: { variant: "outline" },
    past_due: { variant: "warning", label: "past due" },
    suspended: { variant: "destructive" },
    canceled: { variant: "outline" },
    expired: { variant: "outline" },
  },
  subscriptionItem: {
    pending: { variant: "outline" },
    active: { variant: "success" },
    paid: { variant: "success" },
    canceled: { variant: "outline" },
  },
  invoice: {
    draft: { variant: "outline" },
    open: { variant: "outline" },
    paid: { variant: "success" },
    failed: { variant: "destructive" },
    void: { variant: "outline" },
  },
  dunning: {
    reminding: { variant: "warning" },
    suspended: { variant: "destructive" },
    paused: { variant: "outline" },
  },
  health: {
    healthy: { variant: "success" },
    degraded: { variant: "warning" },
    down: { variant: "destructive" },
  },
  dns: {
    verified: { variant: "success" },
    failing: { variant: "destructive" },
    configured: { variant: "outline" },
    unconfigured: { variant: "warning" },
    no_domain: { variant: "outline", label: "no domain" },
    pending: { variant: "outline" },
    handshake_pending: { variant: "outline", label: "awaiting handshake" },
    provisioned: { variant: "success" },
  },
  webhook: {
    pending: { variant: "outline" },
    delivered: { variant: "success" },
    dead: { variant: "destructive" },
    disabled: { variant: "destructive" },
  },
  contact: {
    new: { variant: "default" },
    contacted: { variant: "success" },
    archived: { variant: "outline" },
  },
  thread: {
    open: { variant: "outline" },
    closed: { variant: "secondary" },
  },
  collection: {
    auto_charge: { variant: "success", label: "auto-charge" },
    auto_charge_no_card: { variant: "destructive", label: "auto-charge · no card" },
    send_invoice_card: { variant: "warning", label: "emailed invoice · card on file" },
    send_invoice_no_card: { variant: "destructive", label: "emailed invoice · no card" },
    unknown: { variant: "outline" },
  },
  product: {
    active: { variant: "success" },
    hidden: { variant: "warning" },
  },
  promo: {
    active: { variant: "success" },
    archived: { variant: "outline" },
  },
  tenantRole: Object.fromEntries(
    TENANT_ROLES.map((r) => [r, { variant: "secondary", label: TENANT_ROLE_META[r].label }]),
  ),
  platformRole: Object.fromEntries(
    PLATFORM_ROLES.map((r) => [
      r,
      {
        variant: r === "ops_admin" ? "default" : r === "ops_support" ? "outline" : r === "developer" ? "success" : "secondary",
        label: PLATFORM_ROLE_META[r].label,
      },
    ]),
  ),
  verification: {
    verified: { variant: "success" },
    pending: { variant: "warning" },
  },
  invite: {
    pending: { variant: "outline" },
    accepted: { variant: "success" },
    expired: { variant: "warning" },
    revoked: { variant: "outline" },
  },
  roleRequest: {
    pending: { variant: "warning" },
    approved: { variant: "success" },
    denied: { variant: "destructive", label: "declined" },
    canceled: { variant: "outline", label: "withdrawn" },
  },
  workItem: {
    backlog: { variant: "outline" },
    todo: { variant: "secondary", label: "to do" },
    in_progress: { variant: "default", label: "in progress" },
    in_review: { variant: "warning", label: "in review" },
    done: { variant: "success" },
    canceled: { variant: "outline" },
  },
  workType: {
    feature: { variant: "default" },
    enhancement: { variant: "secondary" },
    bug: { variant: "destructive" },
    task: { variant: "outline" },
  },
  workPriority: {
    urgent: { variant: "destructive" },
    high: { variant: "warning" },
    medium: { variant: "secondary" },
    low: { variant: "outline" },
  },
  sprint: {
    planned: { variant: "outline" },
    active: { variant: "success" },
    completed: { variant: "secondary" },
  },
};

export function statusVariant(kind: StatusKind, status: string | null | undefined): { variant: BadgeVariant; label: string } {
  const key = status ?? "";
  const e = MAP[kind][key];
  return {
    variant: e?.variant ?? "outline",
    label: e?.label ?? (key ? key.replace(/_/g, " ") : "no data"),
  };
}

/** How the next renewal will collect, from Stripe's point of view. */
export function collectionKey(
  a: { collectionMethod: "charge_automatically" | "send_invoice" | null; cardOnFile: boolean; error: string | null } | null | undefined,
): string {
  if (!a || a.error || !a.collectionMethod) return "unknown";
  if (a.collectionMethod === "charge_automatically") return a.cardOnFile ? "auto_charge" : "auto_charge_no_card";
  return a.cardOnFile ? "send_invoice_card" : "send_invoice_no_card";
}
