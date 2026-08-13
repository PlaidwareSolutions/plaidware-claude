import { redirect } from "next/navigation";
import { getSession, isOps } from "@/policy";
import { getUserTenants } from "@/modules/tenancy/queries";
import { unreadCount } from "@/modules/messaging/service";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const tenants = await getUserTenants(session.user.id);
  const activeTenantId =
    tenants.find((t) => t.id === session.session.activeOrganizationId)?.id ??
    tenants[0]?.id ??
    null;
  const ops = isOps(session);
  const [tenantUnread, opsUnread] = await Promise.all([
    activeTenantId ? unreadCount("tenant", activeTenantId) : Promise.resolve(0),
    ops ? unreadCount("ops") : Promise.resolve(0),
  ]);

  return (
    <AppShell
      unread={{ tenant: tenantUnread, ops: opsUnread }}
      user={{
        name: session.user.name,
        email: session.user.email,
        isOps: isOps(session),
      }}
      tenants={tenants}
      activeTenantId={activeTenantId}
    >
      {children}
    </AppShell>
  );
}
