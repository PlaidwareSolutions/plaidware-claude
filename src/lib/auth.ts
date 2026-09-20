import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, organization } from "better-auth/plugins";
import { db } from "../db";
import { env } from "../env";
import { sendEmail, emailShell, emailButton } from "./email";
import { sendInvitationEmail } from "./invite-email";
import { ac, orgRoles } from "./org-roles";
import { disabledOrgPaths } from "./org-http-surface";
import { orgMutationBlockReason } from "../policy/org-guards";
import {
  emitMembershipChanged,
  emitOrganizationUpdated,
} from "../modules/webhooks_out/service";

function forbidIf(reason: string | null): void {
  if (reason) throw new APIError("FORBIDDEN", { message: reason });
}

/**
 * Tenant = Better Auth organization. Instantiated once so the HTTP surface
 * below can be derived from the endpoints it registers.
 */
const orgPlugin = organization({
  ac,
  roles: orgRoles,
  creatorRole: "owner",
  // Workspaces are created only by a first purchase (createCheckoutAction)
  // or ops onboarding, and deleted only by ops (deleteTenant, which refuses
  // while subscriptions are live). Never through Better Auth's own routes.
  allowUserToCreateOrganization: false,
  disableOrganizationDeletion: true,
  schema: {
    organization: {
      additionalFields: {
        // 'active' | 'suspended' | 'inactive' — tenant lifecycle (PRD §4.2)
        status: { type: "string", defaultValue: "active", input: false },
        // Billing identity lives on the tenant, not the user (PRD §2)
        stripeCustomerId: { type: "string", required: false, input: false },
      },
    },
  },
  // MHub lifecycle (integration contract §B): org/membership changes made
  // through Better Auth surface here. The emit functions no-op unless the
  // org holds a live marketing-* subscription, and never throw.
  // Direct-Drizzle mutations (transferOwnership) emit at their own sites.
  organizationHooks: {
    // Defense in depth for the auth.api paths and the one browser route
    // (accept-invitation): the tenant-status gate and the unique-owner rule
    // hold even if a caller skips src/policy. Ops paths in tenancy/service
    // write directly and are unaffected — ops must act on suspended tenants.
    beforeCreateInvitation: async ({ invitation, organization: org }) => {
      forbidIf(orgMutationBlockReason("invite", { status: org.status }, { role: invitation.role }));
    },
    beforeAddMember: async ({ member, organization: org }) => {
      forbidIf(orgMutationBlockReason("add", { status: org.status }, { role: member.role }));
    },
    beforeAcceptInvitation: async ({ invitation, organization: org }) => {
      forbidIf(orgMutationBlockReason("accept", { status: org.status }, { role: invitation.role }));
    },
    beforeUpdateMemberRole: async ({ member, newRole, organization: org }) => {
      forbidIf(orgMutationBlockReason("update-role", { status: org.status }, { role: member.role, newRole }));
    },
    beforeRemoveMember: async ({ member, organization: org }) => {
      forbidIf(orgMutationBlockReason("remove", { status: org.status }, { role: member.role }));
    },
    afterUpdateOrganization: async ({ organization: org }) => {
      if (org) await emitOrganizationUpdated(org.id);
    },
    afterAddMember: async ({ member }) => {
      await emitMembershipChanged({
        orgId: member.organizationId,
        userId: member.userId,
        role: member.role,
        action: "added",
      });
    },
    afterAcceptInvitation: async ({ member }) => {
      await emitMembershipChanged({
        orgId: member.organizationId,
        userId: member.userId,
        role: member.role,
        action: "added",
      });
    },
    afterUpdateMemberRole: async ({ member }) => {
      await emitMembershipChanged({
        orgId: member.organizationId,
        userId: member.userId,
        role: member.role,
        action: "updated",
      });
    },
    afterRemoveMember: async ({ member }) => {
      await emitMembershipChanged({
        orgId: member.organizationId,
        userId: member.userId,
        role: member.role,
        action: "removed",
      });
    },
  },
  sendInvitationEmail: async (data) => {
    await sendInvitationEmail({
      to: data.email,
      invitationId: data.id,
      organizationName: data.organization.name,
      inviterName: data.inviter.user.name,
      role: data.role,
    });
  },
});

export const auth = betterAuth({
  baseURL: env.APP_BASE_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [
    env.APP_BASE_URL,
    ...(env.TRUSTED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ],
  database: drizzleAdapter(db, { provider: "pg" }),
  // Org mutations are server-side only (src/lib/org-http-surface.ts): every
  // /organization/* route except accept-invitation is 404 over HTTP.
  // auth.api.* calls skip the router, so server actions are unaffected.
  disabledPaths: disabledOrgPaths(Object.values(orgPlugin.endpoints).map((e) => e.path)),

  advanced: {
    // Session shared with sibling apps (marketing.plaidware.com) via
    // Domain=.plaidware.com. Unset locally so localhost keeps host-only cookies.
    ...(env.COOKIE_DOMAIN && {
      crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN },
    }),
    // Staging and production both set Domain=.plaidware.com cookies; a
    // per-env name prefix keeps one environment's sign-in from clobbering
    // the other's session in the same browser.
    ...(env.COOKIE_PREFIX && { cookiePrefix: env.COOKIE_PREFIX }),
  },

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
    magicLink({
      // Sign-in only: signup needs firstName/lastName/phone, which a magic
      // link can't collect — new users go through /signup. Verifying the link
      // proves the address, so Better Auth flips emailVerified for
      // still-unverified accounts (consistent with the verification gate).
      disableSignUp: true,
      expiresIn: 60 * 5,
      rateLimit: { window: 60, max: 5 },
      storeToken: "hashed",
      sendMagicLink: async ({ email, url }) => {
        await sendEmail({
          to: email,
          subject: "Your Plaidware sign-in link",
          html: emailShell(
            "Sign in to Plaidware",
            `<p>Click the button below to sign in as ${email}. This link is valid for 5 minutes and can be used once.</p>` +
              emailButton(url, "Sign in") +
              `<p>If you didn't request this, you can safely ignore this email.</p>`,
          ),
        });
      },
    }),
    orgPlugin,
  ],
});

export type Auth = typeof auth;
