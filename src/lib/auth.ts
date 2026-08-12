import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { db } from "../db";
import { env } from "../env";
import { sendEmail, emailShell, emailButton } from "./email";
import { ac, orgRoles } from "./org-roles";

export const auth = betterAuth({
  baseURL: env.APP_BASE_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your Plaidware password",
        html: emailShell(
          "Reset your password",
          `<p>We received a request to reset the password for ${user.email}. This link is valid for one hour.</p>` +
            emailButton(url, "Reset password") +
            `<p>If you didn't request this, you can safely ignore this email.</p>`,
        ),
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24, // 24h, matching the old app's contract
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Confirm your Plaidware email",
        html: emailShell(
          "Confirm your email",
          `<p>Welcome to Plaidware. Confirm your email address to activate your account.</p>` +
            emailButton(url, "Confirm email"),
        ),
      });
    },
  },

  user: {
    additionalFields: {
      firstName: { type: "string", required: true },
      lastName: { type: "string", required: true },
      phone: { type: "string", required: true },
      // 'customer' | 'ops_admin' — never settable from client input
      platformRole: { type: "string", defaultValue: "customer", input: false },
    },
  },

  plugins: [
    organization({
      ac,
      roles: orgRoles,
      creatorRole: "owner",
      // Invite emails get their real template in M2's tenancy milestone.
      sendInvitationEmail: async (data) => {
        const url = `${env.APP_BASE_URL}/invite/${data.id}`;
        await sendEmail({
          to: data.email,
          subject: `You're invited to ${data.organization.name} on Plaidware`,
          html: emailShell(
            `Join ${data.organization.name}`,
            `<p>${data.inviter.user.name} invited you to join <strong>${data.organization.name}</strong> as ${data.role}.</p>` +
              emailButton(url, "Accept invitation"),
          ),
        });
      },
    }),
  ],
});

export type Auth = typeof auth;
