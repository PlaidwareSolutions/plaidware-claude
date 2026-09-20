import { redirect } from "next/navigation";
import { getSession, hasWorkAccess, isDeveloper, isOps, opsLevel } from "@/policy";
import { countPendingRoleRequests, getUserTenants } from "@/modules/tenancy/queries";
import { pickActiveTenant } from "@/modules/tenancy/active-tenant";
import { roleHasCapability } from "@/policy/capabilities";
import { unreadCount } from "@/modules/messaging/service";
import { getWorkNavCounts, listBoardsNav } from "@/modules/work/queries";
import { AppShell } from "@/components/app-shell";
import { AUTH } from "@/lib/routes";
import { getOpsNavCounts } from "./ops/nav-counts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect(AUTH.login);

  const dev = isDeveloper(session);
  const work = hasWorkAccess(session);
  // Developers hold no workspace in the UI even if a membership exists (getTenantContext bounces them).
  const tenants = dev ? [] : await getUserTenants(session.user.id);
  const active = pickActiveTenant(tenants, session.session.activeOrganizationId);
  const activeTenantId = active?.id ?? null;
  const ops = isOps(session);
  const decidesRoles = !!active && roleHasCapability(active.role, "team");
  const [tenantUnread, tenantTeam, opsCounts, workCounts, workBoards] = await Promise.all([
    activeTenantId ? unreadCount("tenant", activeTenantId) : Promise.resolve(0),
    activeTenantId && decidesRoles ? countPendingRoleRequests(activeTenantId) : Promise.resolve(0),
    ops ? getOpsNavCounts() : Promise.resolve(undefined),
    work ? getWorkNavCounts(session.user.id) : Promise.resolve(undefined),
    work ? listBoardsNav() : Promise.resolve(undefined),
  ]);

  return (
    <AppShell
      counts={{ tenantUnread, tenantTeam, ops: opsCounts, work: workCounts }}
      user={{
        name: session.user.name,
        email: session.user.email,
        isOps: ops,
        isDeveloper: dev,
        opsLevel: opsLevel(session),
      }}
      tenants={tenants}
      activeTenantId={activeTenantId}
      workBoards={workBoards}
    >
      {children}
    </AppShell>
  );
}
