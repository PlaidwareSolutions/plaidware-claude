import { env } from "../env";
import { emailButton, emailShell, sendEmail } from "./email";
import { TENANT } from "@/lib/routes";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/**
 * Better Auth's one verification callback serves two flows: signup (and the
 * resend from /check-email) pass an unverified user; a verified user's
 * change-email request passes the session user with the NEW address. The
 * verified flag is the discriminator.
 */
export async function sendAccountVerificationEmail(data: {
  user: { email: string; emailVerified: boolean };
  url: string;
}): Promise<void> {
  if (data.user.emailVerified) {
    await sendEmail({
      to: data.user.email,
      subject: "Confirm your new Plaidware email",
      html: emailShell(
        "Confirm your new email",
        `<p>Confirm this address to make it your sign-in email for Plaidware. Until then you keep signing in as before. This link is valid for 24 hours.</p>` +
          emailButton(data.url, "Confirm new email") +
          `<p style="color:#8b93b2;font-size:13px">If you didn't ask for this, ignore it — nothing changes.</p>`,
      ),
    });
    return;
  }
  await sendEmail({
    to: data.user.email,
    subject: "Confirm your Plaidware email",
    html: emailShell(
      "Confirm your email",
      `<p>Welcome to Plaidware. Confirm your email address to activate your account.</p>` + emailButton(data.url, "Confirm email"),
    ),
  });
}

/** To the OLD address when a change is requested — a heads-up, not a gate. */
export async function sendEmailChangeNoticeEmail(opts: { to: string; newEmail: string }): Promise<void> {
  await sendEmail({
    to: opts.to,
    subject: "Your Plaidware sign-in email is being changed",
    html: emailShell(
      "Email change requested",
      `<p>Someone signed in to your Plaidware account asked to change its sign-in email to <strong>${esc(opts.newEmail)}</strong>. If that was you, confirm from the link sent there.</p>` +
        `<p>If it wasn't, change your password now and sign out your other devices from account settings.</p>` +
        emailButton(`${env.APP_BASE_URL}${TENANT.settings}`, "Open account settings"),
    ),
  });
}
