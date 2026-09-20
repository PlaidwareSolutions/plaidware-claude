import { Activity, Building2, CalendarClock, KeyRound } from "lucide-react";
import type { PlatformUserDetail } from "../queries";
import { PlatformRoleSelect } from "./platform-role-select";
import { OPS } from "@/lib/routes";
import { formatDate, formatDateTime, formatRelative } from "@/lib/dates";
import { formatPhone, isPlaceholderPhone } from "@/lib/phone";
import { accountStatusOf } from "@/lib/account-status";
import { Section } from "@/components/section";
import { StatTile } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b py-2 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2 text-heading">{children}</dd>
    </div>
  );
}

/** The Overview tab of an account: KPIs and the profile/status definition list. */
export function UserOverview({
  user,
  selfUserId,
  opsAdminCount,
}: {
  user: PlatformUserDetail;
  selfUserId: string;
  opsAdminCount: number;
}) {
  const disabled = !!user.disabledAt;
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Workspaces" value={user.membershipCount} icon={Building2} href={OPS.userTab(user.id, "workspaces")} />
        <StatTile
          label="Active sessions"
          value={user.activeSessionCount}
          icon={Activity}
          href={OPS.userTab(user.id, "sessions")}
          tone={disabled && user.activeSessionCount > 0 ? "danger" : "default"}
        />
        <StatTile
          label="Last seen"
          value={user.lastSeenAt ? formatRelative(user.lastSeenAt) : "never"}
          sub={user.lastSeenAt ? formatDateTime(user.lastSeenAt) : "has not signed in yet"}
          icon={CalendarClock}
          tone={user.lastSeenAt ? "default" : "warning"}
        />
        <StatTile
          label="Password"
          value={user.hasPassword ? "set" : "not set"}
          sub={user.hasPassword ? "can sign in with a password" : "needs the set-password link or a magic link"}
          icon={KeyRound}
          tone={user.hasPassword ? "default" : "warning"}
        />
      </div>

      <Section title="Account" card>
        <dl className="grid text-sm">
          <Row label="Email">
            {user.email}
            <StatusBadge kind="verification" status={user.emailVerified ? "verified" : "pending"} className="text-[10px]" />
          </Row>
          <Row label="Name">
            {user.firstName} {user.lastName}
          </Row>
          <Row label="Phone">
            {isPlaceholderPhone(user.phone) ? (
              <span className="text-warning">not collected — the person adds it from their account page</span>
            ) : (
              formatPhone(user.phone)
            )}
          </Row>
          <Row label="Platform role">
            <PlatformRoleSelect user={user} selfUserId={selfUserId} opsAdminCount={opsAdminCount} />
          </Row>
          <Row label="Status">
            <StatusBadge kind="accountStatus" status={accountStatusOf(user.disabledAt)} />
            {disabled && (
              <span className="text-xs text-muted-foreground">
                since {formatDate(user.disabledAt!)}
                {user.disabledReason ? ` — ${user.disabledReason}` : ""}
              </span>
            )}
          </Row>
          <Row label="Created">{formatDateTime(user.createdAt)}</Row>
          <Row label="Updated">{formatDateTime(user.updatedAt)}</Row>
        </dl>
      </Section>
    </div>
  );
}
