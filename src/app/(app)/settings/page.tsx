import { redirect } from "next/navigation";
import { getSession, isDeveloper } from "@/policy";
import { AUTH } from "@/lib/routes";
import { isPlaceholderPhone } from "@/lib/phone";
import { formatDate } from "@/lib/dates";
import { getUserTenants } from "@/modules/tenancy/queries";
import { pickActiveTenant } from "@/modules/tenancy/active-tenant";
import { listOwnSessions } from "@/modules/account/queries";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { ProfileForm } from "@/components/account/profile-form";
import { EmailForm } from "@/components/account/email-form";
import { SettingsNotices } from "@/components/account/settings-notices";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { SessionsPanel } from "@/components/account/sessions-panel";
import { AccessPanel } from "@/components/account/access-panel";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/** The signed-in user's own account — reachable by customers, ops and developers alike. */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string }>;
}) {
  const [session, notices] = await Promise.all([getSession(), searchParams]);
  if (!session) redirect(AUTH.login);
  const u = session.user;
  const dev = isDeveloper(session);
  // A developer's memberships are listed too (their Work → Clients context), but never as an active workspace.
  const [sessions, tenants] = await Promise.all([listOwnSessions(u.id, session.session.id), getUserTenants(u.id)]);
  const activeTenantId = dev ? null : (pickActiveTenant(tenants, session.session.activeOrganizationId)?.id ?? null);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <PageHeader title="Settings" description="Your account." />
      <SettingsNotices email={notices.email} error={notices.error} />

      <Section title="Profile" description={`Member since ${formatDate(u.createdAt)}.`} card>
        <ProfileForm
          initial={{ firstName: u.firstName, lastName: u.lastName, phone: u.phone }}
          phoneIsPlaceholder={isPlaceholderPhone(u.phone)}
        />
      </Section>

      <Section title="Email" description="Changing it sends a confirmation link to the new address." card>
        <EmailForm email={u.email} emailVerified={u.emailVerified} />
      </Section>

      <Section title="Password" description="Changing it signs out your other sessions." card>
        <ChangePasswordForm />
      </Section>

      <Section title="Sessions" description="Where you're signed in right now.">
        <SessionsPanel sessions={sessions} />
      </Section>

      <Section title="Your access">
        <AccessPanel platformRole={u.platformRole} isDeveloper={dev} tenants={tenants} activeTenantId={activeTenantId} />
      </Section>
    </div>
  );
}
