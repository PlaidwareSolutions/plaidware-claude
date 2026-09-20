import { env } from "../env";
import { emailButton, emailShell, sendEmail } from "./email";
import { AUTH } from "@/lib/routes";

/** The workspace invitation email — sent by Better Auth's org plugin and by ops-side invites alike. */
export async function sendInvitationEmail(opts: {
  to: string;
  invitationId: string;
  organizationName: string;
  inviterName: string;
  role: string;
}): Promise<void> {
  const url = `${env.APP_BASE_URL}${AUTH.invite(opts.invitationId)}`;
  await sendEmail({
    to: opts.to,
    subject: `You're invited to ${opts.organizationName} on Plaidware`,
    html: emailShell(
      `Join ${opts.organizationName}`,
      `<p>${opts.inviterName} invited you to join <strong>${opts.organizationName}</strong> as ${opts.role}.</p>` +
        emailButton(url, "Accept invitation") +
        `<p style="color:#8b93b2;font-size:13px">The invitation expires in 7 days. If you don't have a Plaidware account yet, you'll create one on the next screen.</p>`,
    ),
  });
}
