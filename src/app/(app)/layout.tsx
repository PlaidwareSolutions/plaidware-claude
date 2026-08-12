import { redirect } from "next/navigation";
import { getSession, isOps } from "@/policy";
import { getUserTenants } from "@/modules/tenancy/queries";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const tenants = await getUserTenants(session.user.id);
  const activeTenantId =
    tenants.find((t) => t.id === session.session.activeOrganizationId)?.id ??
    tenants[0]?.id ??
    null;

  return (
    <AppShell
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
