import { PLATFORM_ROLE_META, normalizePlatformRole } from "@/lib/roles";

/**
 * Every audit `kind` the app writes, with the label and group the Activity
 * tab renders. Unknown kinds still render (humanised) so a new writer never
 * hides its rows.
 */
export type AuditGroup = "setup" | "billing" | "provisioning" | "people" | "workspace" | "monitoring" | "platform";

export const AUDIT_GROUPS: { key: AuditGroup; label: string }[] = [
  { key: "setup", label: "Setup" },
  { key: "billing", label: "Billing" },
  { key: "provisioning", label: "Provisioning" },
  { key: "people", label: "People" },
  { key: "workspace", label: "Workspace" },
  { key: "monitoring", label: "Monitoring" },
  { key: "platform", label: "Platform" },
];

const KINDS: Record<string, { label: string; group: AuditGroup }> = {
  client_setup_created: { label: "Setup link created", group: "setup" },
  client_setup_completed: { label: "Client completed setup", group: "setup" },
  client_setup_revoked: { label: "Setup link revoked", group: "setup" },
  client_setup_expired: { label: "Setup link expired", group: "setup" },
  setup_pricing_released: { label: "Setup-link prices released", group: "setup" },
  price_override_set: { label: "Custom price set", group: "billing" },
  price_override_cleared: { label: "Custom price cleared", group: "billing" },
  hosting_fee_set: { label: "Hosting fee set", group: "billing" },
  hosting_fee_cleared: { label: "Hosting fee removed", group: "billing" },
  dunning_paused: { label: "Dunning paused", group: "billing" },
  dunning_resumed: { label: "Dunning resumed", group: "billing" },
  subscription_suspended: { label: "Subscription suspended", group: "billing" },
  subscription_reactivated: { label: "Subscription reactivated", group: "billing" },
  subscription_items_changed: { label: "Add-ons changed", group: "billing" },
  domain_changed: { label: "Domain changed", group: "provisioning" },
  dns_config_changed: { label: "DNS verification configured", group: "provisioning" },
  dns_verified: { label: "DNS verification run", group: "provisioning" },
  credential_added: { label: "Credential added", group: "provisioning" },
  credential_updated: { label: "Credential updated", group: "provisioning" },
  credential_deleted: { label: "Credential deleted", group: "provisioning" },
  credential_revealed: { label: "Credential revealed", group: "provisioning" },
  member_invited: { label: "Member invited", group: "people" },
  invite_canceled: { label: "Invitation canceled", group: "people" },
  member_role_changed: { label: "Member role changed", group: "people" },
  member_removed: { label: "Member removed", group: "people" },
  member_phone_updated: { label: "Member phone updated", group: "people" },
  ownership_transferred: { label: "Ownership transferred", group: "people" },
  role_requested: { label: "Role change requested", group: "people" },
  role_request_approved: { label: "Role request approved", group: "people" },
  role_request_denied: { label: "Role request declined", group: "people" },
  role_request_canceled: { label: "Role request withdrawn", group: "people" },
  platform_role_changed: { label: "Platform role changed", group: "platform" },
  platform_account_created: { label: "Account created by ops", group: "platform" },
  account_disabled: { label: "Account disabled", group: "platform" },
  account_enabled: { label: "Account re-enabled", group: "platform" },
  sessions_revoked: { label: "Sessions revoked by ops", group: "platform" },
  workspace_status_changed: { label: "Workspace status changed", group: "workspace" },
  incident_acknowledged: { label: "Incident acknowledged", group: "monitoring" },
};

export function auditLabel(kind: string): string {
  return KINDS[kind]?.label ?? kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function auditGroup(kind: string): AuditGroup {
  return KINDS[kind]?.group ?? "workspace";
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);

/** One-line detail from the payload, per kind. Money is in cents. */
export function describeAudit(
  kind: string,
  payload: Record<string, unknown>,
  fmt: { cents: (c: number) => string },
): string | null {
  switch (kind) {
    case "domain_changed":
      return `→ ${str(payload.after) ?? "cleared"}`;
    case "dns_verified":
      return `${payload.ok ? "passed" : "failed"} (${str(payload.mode) ?? "?"})${str(payload.detail) ? ` — ${payload.detail}` : ""}`;
    case "dns_config_changed":
      return [
        payload.auto ? "auto-configured" : null,
        str(payload.expectedCname) ? `CNAME ${payload.expectedCname}` : null,
        str(payload.expectedAIps) ? `A ${payload.expectedAIps}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null;
    case "price_override_set":
      return num(payload.amountCents) != null
        ? `${fmt.cents(payload.amountCents as number)}${payload.sourceInviteId ? " · from setup link" : ""}`
        : null;
    case "hosting_fee_set":
      return num(payload.monthlyHostingCents) != null
        ? `${fmt.cents(payload.monthlyHostingCents as number)}/mo from ${str(payload.startMonth) ?? "now"}`
        : null;
    case "subscription_suspended":
      return `${str(payload.source) ?? "dunning"}${str(payload.note) ? ` — ${payload.note}` : ""}${str(payload.invoiceNumber) ? ` (invoice ${payload.invoiceNumber})` : ""}`;
    case "subscription_reactivated":
      return `was ${str(payload.source) ?? "dunning"} hold`;
    case "workspace_status_changed":
      return `${str(payload.before) ?? "?"} → ${str(payload.after) ?? "?"}${str(payload.note) ? ` — ${payload.note}` : ""}`;
    case "member_invited":
      return `${str(payload.email) ?? ""} as ${str(payload.role) ?? "member"}`;
    case "member_role_changed":
      return `${str(payload.before) ?? "?"} → ${str(payload.after) ?? "?"}`;
    case "invite_canceled":
      return str(payload.email);
    case "role_requested":
      return `${str(payload.before) ?? "?"} → ${str(payload.requested) ?? "?"}${str(payload.note) ? ` — ${payload.note}` : ""}`;
    case "role_request_approved":
      return `${str(payload.before) ?? "?"} → ${str(payload.after) ?? "?"}`;
    case "role_request_denied":
      return `${str(payload.requested) ?? "?"}${str(payload.note) ? ` — ${payload.note}` : ""}`;
    case "role_request_canceled": {
      const why = str(payload.reason);
      const label = why === "requester" ? "withdrawn by requester" : why === "role_changed" ? "role changed directly" : why === "decider" ? "dismissed" : why;
      return `${str(payload.requested) ?? "?"}${label ? ` · ${label}` : ""}`;
    }
    case "ownership_transferred":
      return `${str(payload.fromEmail) ?? "?"} → ${str(payload.toEmail) ?? "?"}`;
    case "platform_role_changed": {
      const role = (v: unknown) => (str(v) ? PLATFORM_ROLE_META[normalizePlatformRole(str(v))].label : "?");
      return `${str(payload.targetEmail) ?? "?"}: ${role(payload.before)} → ${role(payload.after)}${payload.sessionsRevoked ? " · signed out" : ""}`;
    }
    case "account_disabled":
    case "account_enabled": {
      const n = num(payload.sessionsRevoked);
      return [str(payload.targetEmail) ?? "?", str(payload.reason) ? `— ${payload.reason}` : null, n ? `· ${n} session${n === 1 ? "" : "s"} revoked` : null]
        .filter(Boolean)
        .join(" ");
    }
    case "sessions_revoked": {
      const n = num(payload.count) ?? 0;
      return `${str(payload.targetEmail) ?? "?"} · ${payload.all ? `all ${n} session${n === 1 ? "" : "s"}` : "one device"}`;
    }
    case "platform_account_created":
      return str(payload.targetEmail) ? `${payload.targetEmail} · ${str(payload.role) ?? "developer"}` : null;
    case "client_setup_created":
      return payload.regenerated ? "link regenerated" : str(payload.email);
    case "setup_pricing_released": {
      const n = Array.isArray(payload.components) ? payload.components.length : 0;
      return `${n} negotiated price${n === 1 ? "" : "s"} applied to this setup only — later purchases use list price`;
    }
    case "credential_added":
    case "credential_updated":
    case "credential_deleted":
    case "credential_revealed":
      return str(payload.label);
    default:
      return null;
  }
}
