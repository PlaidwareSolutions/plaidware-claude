import { env } from "../env";
import { emailButton, emailShell, sendEmail } from "./email";
import { TENANT } from "@/lib/routes";
import { TENANT_ROLE_META, isTenantRole } from "@/lib/roles";

const label = (r: string) => (isTenantRole(r) ? TENANT_ROLE_META[r].label : r);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** To each owner/admin when a member asks for a different role. */
export async function sendRoleRequestedEmail(opts: {
  to: string;
  requesterName: string;
  organizationName: string;
  currentRole: string;
  requestedRole: string;
  note: string | null;
}): Promise<void> {
  await sendEmail({
    to: opts.to,
    subject: `Role change request in ${opts.organizationName}`,
    html: emailShell(
      "Role change request",
      `<p><strong>${esc(opts.requesterName)}</strong> asked to become <strong>${label(opts.requestedRole)}</strong> in ${esc(opts.organizationName)} (currently ${label(opts.currentRole)}).</p>` +
        (opts.note ? `<blockquote style="border-left:3px solid #d0d5e6;margin:0;padding:4px 12px;color:#4b5270">${esc(opts.note)}</blockquote>` : "") +
        emailButton(`${env.APP_BASE_URL}${TENANT.team}`, "Review request") +
        `<p style="color:#8b93b2;font-size:13px">Approve or deny it from the Team page. If ${esc(opts.organizationName)} isn't your active workspace, switch to it first.</p>`,
    ),
  });
}

/** To the requester once an owner, admin or Plaidware decides. */
export async function sendRoleRequestDecidedEmail(opts: {
  to: string;
  organizationName: string;
  requestedRole: string;
  decision: "approved" | "denied";
  decisionNote: string | null;
  deciderName: string | null;
}): Promise<void> {
  const who = opts.deciderName ? esc(opts.deciderName) : "A workspace owner";
  const approved = opts.decision === "approved";
  await sendEmail({
    to: opts.to,
    subject: approved
      ? `You're now ${label(opts.requestedRole)} in ${opts.organizationName}`
      : `Your role request in ${opts.organizationName} was declined`,
    html: emailShell(
      approved ? "Role request approved" : "Role request declined",
      (approved
        ? `<p>${who} made you <strong>${label(opts.requestedRole)}</strong> in ${esc(opts.organizationName)}. ${esc(TENANT_ROLE_META[isTenantRole(opts.requestedRole) ? opts.requestedRole : "member"].description)}.</p>`
        : `<p>${who} declined your request to become ${label(opts.requestedRole)} in ${esc(opts.organizationName)}.</p>`) +
        (opts.decisionNote ? `<blockquote style="border-left:3px solid #d0d5e6;margin:0;padding:4px 12px;color:#4b5270">${esc(opts.decisionNote)}</blockquote>` : "") +
        emailButton(`${env.APP_BASE_URL}${approved ? TENANT.dashboard : TENANT.team}`, approved ? "Open workspace" : "Open Team") +
        (approved ? "" : `<p style="color:#8b93b2;font-size:13px">You can ask again, or talk to a workspace owner if you think this is a mistake.</p>`),
    ),
  });
}
