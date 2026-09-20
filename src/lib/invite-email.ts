import { env } from "../env";
import { emailButton, emailShell, sendEmail } from "./email";
import { AUTH } from "@/lib/routes";

/** How long a workspace invitation stays valid — the email copy, the Hub's rows and Better Auth's expiry all use this. */
export const INVITATION_DAYS = 7;

/** The workspace invitation email — sent by Better Auth's org plugin, ops-side invites, and resends alike. */
export async function sendInvitationEmail(opts: {
  to: string;
  invitationId: string;
  organizationName: string;
  inviterName: string;
  role: string;
}): Promise<{ sent: boolean; error?: string }> {
  const url = `${env.APP_BASE_URL}${AUTH.invite(opts.invitationId)}`;
  return sendEmail({
    to: opts.to,
    subject: `You're invited to ${opts.organizationName} on Plaidware`,
    html: emailShell(
      `Join ${opts.organizationName}`,
      `<p>${opts.inviterName} invited you to join <strong>${opts.organizationName}</strong> as ${opts.role}.</p>` +
        emailButton(url, "Accept invitation") +
        `<p style="color:#8b93b2;font-size:13px">The invitation expires in ${INVITATION_DAYS} days. If you don't have a Plaidware account yet, you'll create one on the next screen.</p>`,
    ),
  });
}
