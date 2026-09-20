import { redirect } from "next/navigation";
import { getSession, isOps, opsLevel } from "@/policy";
import { countPendingRoleRequests, getUserTenants } from "@/modules/tenancy/queries";
import { pickActiveTenant } from "@/modules/tenancy/active-tenant";
import { roleHasCapability } from "@/policy/capabilities";
import { unreadCount } from "@/modules/messaging/service";
import { AppShell } from "@/components/app-shell";
import { AUTH } from "@/lib/routes";
import { getOpsNavCounts } from "./ops/nav-counts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect(AUTH.login);

  const tenants = await getUserTenants(session.user.id);
  const active = pickActiveTenant(tenants, session.session.activeOrganizationId);
  const activeTenantId = active?.id ?? null;
  const ops = isOps(session);
  const decidesRoles = !!active && roleHasCapability(active.role, "team");
  const [tenantUnread, tenantTeam, opsCounts] = await Promise.all([
    activeTenantId ? unreadCount("tenant", activeTenantId) : Promise.resolve(0),
    activeTenantId && decidesRoles ? countPendingRoleRequests(activeTenantId) : Promise.resolve(0),
    ops ? getOpsNavCounts() : Promise.resolve(undefined),
  ]);

  return (
    <AppShell
      counts={{ tenantUnread, tenantTeam, ops: opsCounts }}
      user={{
        name: session.user.name,
        email: session.user.email,
        isOps: ops,
        opsLevel: opsLevel(session),
      }}
      tenants={tenants}
      activeTenantId={activeTenantId}
    >
      {children}
    </AppShell>
  );
}
