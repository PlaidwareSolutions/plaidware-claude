import { redirect } from "next/navigation";
import { getSession, isOps, opsLevel } from "@/policy";
import { getUserTenants } from "@/modules/tenancy/queries";
import { pickActiveTenant } from "@/modules/tenancy/active-tenant";
import { unreadCount } from "@/modules/messaging/service";
import { AppShell } from "@/components/app-shell";
import { AUTH } from "@/lib/routes";
import { getOpsNavCounts } from "./ops/nav-counts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect(AUTH.login);

  const tenants = await getUserTenants(session.user.id);
  const activeTenantId = pickActiveTenant(tenants, session.session.activeOrganizationId)?.id ?? null;
  const ops = isOps(session);
  const [tenantUnread, opsCounts] = await Promise.all([
    activeTenantId ? unreadCount("tenant", activeTenantId) : Promise.resolve(0),
    ops ? getOpsNavCounts() : Promise.resolve(undefined),
  ]);

  return (
    <AppShell
      counts={{ tenantUnread, ops: opsCounts }}
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
