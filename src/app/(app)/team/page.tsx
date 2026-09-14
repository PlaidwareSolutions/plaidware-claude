import { redirect } from "next/navigation";
import { getSession, isOps, roleHasCapability, tenantStatusAllows, tenantStatusMessage } from "@/policy";
import { AUTH, TENANT } from "@/lib/routes";
import {
  getUserTenants,
  listMembers,
  listPendingInvites,
} from "@/modules/tenancy/queries";
import { TeamManager } from "@/modules/tenancy/components/team-manager";

export default async function TeamPage() {
  const session = await getSession();
  if (!session) redirect(AUTH.login);

  const tenants = await getUserTenants(session.user.id);
  const active =
    tenants.find((t) => t.id === session.session.activeOrganizationId) ?? tenants[0];
  if (!active) redirect(TENANT.dashboard);

  const [members, invites] = await Promise.all([
    listMembers(active.id),
    listPendingInvites(active.id),
  ]);

  const ops = isOps(session);
  const statusAllows = ops || tenantStatusAllows(active.status, "team");
  const canManage = (ops || roleHasCapability(active.role, "team")) && statusAllows;
  const isOwner = active.role === "owner" || ops;

  return (
    <TeamManager
      tenantId={active.id}
      tenantName={active.name}
      members={members}
      invites={invites}
      canManage={canManage}
      readOnlyReason={statusAllows ? null : tenantStatusMessage(active.status)}
      isOwner={isOwner}
      selfUserId={session.user.id}
    />
  );
}
