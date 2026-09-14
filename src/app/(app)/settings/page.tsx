import { redirect } from "next/navigation";
import { getSession } from "@/policy";
import { AUTH } from "@/lib/routes";
import { formatPhone, isPlaceholderPhone } from "@/lib/phone";
import { formatDate } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { ChangePasswordForm } from "@/components/account/change-password-form";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect(AUTH.login);
  const u = session.user;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <PageHeader title="Settings" description="Your account." />

      <Section title="Profile" card>
        <dl className="grid gap-3 text-sm">
          <div className="flex justify-between gap-4 border-b pb-2">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="text-heading">{u.name}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b pb-2">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="flex items-center gap-2 text-heading">
              {u.email}
              <StatusBadge kind="verification" status={u.emailVerified ? "verified" : "pending"} className="text-[10px]" />
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b pb-2">
            <dt className="text-muted-foreground">Phone</dt>
            <dd className={isPlaceholderPhone(u.phone) ? "text-warning" : "text-heading"}>
              {isPlaceholderPhone(u.phone) ? "not on file — tell your Plaidware contact" : formatPhone(u.phone)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Member since</dt>
            <dd className="text-heading">{formatDate(u.createdAt)}</dd>
          </div>
        </dl>
      </Section>

      <Section title="Password" description="Changing it signs out your other sessions." card>
        <ChangePasswordForm />
      </Section>
    </div>
  );
}
