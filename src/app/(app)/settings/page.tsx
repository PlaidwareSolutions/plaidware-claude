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
import { StatusBadge } from "@/components/status-badge";
import { ProfileForm } from "@/components/account/profile-form";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { SessionsPanel } from "@/components/account/sessions-panel";
import { AccessPanel } from "@/components/account/access-panel";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/** The signed-in user's own account — reachable by customers, ops and developers alike. */
export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect(AUTH.login);
  const u = session.user;
  const dev = isDeveloper(session);
  const [sessions, tenants] = await Promise.all([
    listOwnSessions(u.id, session.session.id),
    dev ? Promise.resolve([]) : getUserTenants(u.id),
  ]);
  const activeTenantId = pickActiveTenant(tenants, session.session.activeOrganizationId)?.id ?? null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <PageHeader title="Settings" description="Your account." />

      <Section title="Profile" description={`Member since ${formatDate(u.createdAt)}.`} card>
        <ProfileForm
          initial={{ firstName: u.firstName, lastName: u.lastName, phone: u.phone }}
          phoneIsPlaceholder={isPlaceholderPhone(u.phone)}
        />
      </Section>

      <Section title="Email" card>
        <div className="flex items-center gap-2 text-sm text-heading">
          {u.email}
          <StatusBadge kind="verification" status={u.emailVerified ? "verified" : "pending"} className="text-[10px]" />
        </div>
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
