import { OPS } from "../../lib/routes";
import { isPlaceholderPhone } from "../../lib/phone";
import { roleLabel, roleRequestAttentionTone } from "./role-request-rules";

/** One "needs a human" line on the client Overview, linking to the tab that fixes it. */
export type AttentionItem = {
  key: string;
  tone: "danger" | "warning" | "info";
  title: string;
  detail?: string;
  href: string;
};

const SOON_DAYS = 3;

export function buildAttentionItems(
  input: {
    tenantId: string;
    status: string;
    subscriptions: { id: string; productName: string; status: string; suspensionSource: string | null }[];
    wontAutoCollect: { subscriptionId: string; productName: string; reason: string }[];
    pastDueCount: number;
    provisioning: { subscriptionId: string; productName: string; state: string }[];
    incidents: { productName: string }[];
    quiet: { productName: string }[];
    setupInvites: { id: string; status: string; isExpired: boolean; expiresAt: string; clientEmail: string }[];
    deliveries: { dead: number; pending: number };
    members: { role: string; lastSeenAt: Date | string | null; phone: string; emailVerified: boolean }[];
    roleRequests: { id: string; requesterName: string; requestedRole: string; createdAt: Date | string }[];
  },
  now = new Date(),
): AttentionItem[] {
  const t = input.tenantId;
  const out: AttentionItem[] = [];
  const tab = (name: Parameters<typeof OPS.clientTab>[1]) => OPS.clientTab(t, name);

  if (input.status === "suspended") {
    out.push({ key: "ws-suspended", tone: "danger", title: "Workspace suspended", detail: "Members can sign in to billing only.", href: tab("people") });
  } else if (input.status === "inactive") {
    out.push({ key: "ws-inactive", tone: "warning", title: "Workspace inactive", detail: "Members have read-only access.", href: tab("people") });
  }

  for (const s of input.subscriptions) {
    if (s.status === "suspended") {
      out.push({
        key: `sub-suspended-${s.id}`,
        tone: "danger",
        title: `${s.productName} suspended`,
        detail: s.suspensionSource === "manual" ? "Manual hold — reactivate from Billing." : "Dunning hold — lifts when the invoice is paid.",
        href: tab("billing"),
      });
    } else if (s.status === "past_due") {
      out.push({ key: `sub-pastdue-${s.id}`, tone: "warning", title: `${s.productName} is past due`, href: tab("billing") });
    } else if (s.status === "incomplete") {
      out.push({ key: `sub-incomplete-${s.id}`, tone: "info", title: `${s.productName} checkout never completed`, href: tab("billing") });
    }
  }
  if (input.pastDueCount > 0) {
    out.push({
      key: "inv-pastdue",
      tone: "warning",
      title: `${input.pastDueCount} past-due invoice${input.pastDueCount === 1 ? "" : "s"}`,
      detail: "Dunning reminders are running; record an offline payment if one arrived.",
      href: tab("billing"),
    });
  }
  for (const w of input.wontAutoCollect) {
    out.push({
      key: `collect-${w.subscriptionId}`,
      tone: "warning",
      title: `${w.productName} won't auto-collect`,
      detail: w.reason[0].toUpperCase() + w.reason.slice(1) + ".",
      href: tab("billing"),
    });
  }

  for (const p of input.provisioning) {
    if (p.state === "no_domain") {
      out.push({ key: `dns-none-${p.subscriptionId}`, tone: "info", title: `${p.productName}: no live domain yet`, href: tab("provisioning") });
    } else if (p.state === "unconfigured") {
      out.push({ key: `dns-unconf-${p.subscriptionId}`, tone: "warning", title: `${p.productName}: DNS verification not configured`, detail: "One click mints the TXT token and records to send the client.", href: tab("provisioning") });
    } else if (p.state === "failing") {
      out.push({ key: `dns-fail-${p.subscriptionId}`, tone: "danger", title: `${p.productName}: DNS verification failing`, href: tab("provisioning") });
    } else if (p.state === "handshake_pending") {
      out.push({ key: `mhub-${p.subscriptionId}`, tone: "warning", title: `${p.productName}: waiting for the MHub handshake`, href: tab("provisioning") });
    }
  }

  for (const i of input.incidents) {
    out.push({ key: `incident-${i.productName}`, tone: "danger", title: `${i.productName} is down or degraded`, href: tab("monitoring") });
  }
  for (const q of input.quiet) {
    out.push({ key: `quiet-${q.productName}`, tone: "warning", title: `${q.productName} reporter has gone quiet`, href: tab("monitoring") });
  }

  for (const inv of input.setupInvites) {
    if (inv.status !== "pending") continue;
    const msLeft = new Date(inv.expiresAt).getTime() - now.getTime();
    if (inv.isExpired || msLeft <= 0) {
      out.push({ key: `invite-expired-${inv.id}`, tone: "warning", title: `Setup link for ${inv.clientEmail} expired`, detail: "Regenerate it from the setup links card.", href: OPS.client(t) });
    } else if (msLeft < SOON_DAYS * 86_400_000) {
      out.push({ key: `invite-soon-${inv.id}`, tone: "info", title: `Setup link for ${inv.clientEmail} expires in ${Math.max(1, Math.ceil(msLeft / 86_400_000))} day${msLeft < 86_400_000 * 1.5 ? "" : "s"}`, href: OPS.client(t) });
    }
  }

  if (input.deliveries.dead > 0) {
    out.push({ key: "mhub-dead", tone: "danger", title: `${input.deliveries.dead} MHub deliver${input.deliveries.dead === 1 ? "y" : "ies"} dead-lettered`, href: tab("activity") });
  }

  for (const r of input.roleRequests) {
    out.push({
      key: `role-req-${r.id}`,
      tone: roleRequestAttentionTone(r.createdAt, now),
      title: `${r.requesterName} asked to become ${roleLabel(r.requestedRole)}`,
      detail: "Approve or decline from People.",
      href: tab("people"),
    });
  }

  const owner = input.members.find((m) => m.role === "owner");
  if (owner && !owner.lastSeenAt) {
    out.push({ key: "owner-never", tone: "info", title: "Owner has never signed in", href: tab("people") });
  }
  if (owner && isPlaceholderPhone(owner.phone)) {
    out.push({ key: "owner-phone", tone: "info", title: "Owner phone not collected", detail: "Set it from People so the client is reachable.", href: tab("people") });
  }

  return out;
}
