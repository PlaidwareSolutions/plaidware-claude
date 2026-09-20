import { requireTenantPage } from "@/policy";
import {
  getOpenRoleRequestForUser,
  listMembers,
  listPendingInvites,
  listPendingRoleRequests,
} from "@/modules/tenancy/queries";
import { canRequestRoleChange } from "@/modules/tenancy/role-request-rules";
import { TeamManager } from "@/modules/tenancy/components/team-manager";
import { isAssignableTenantRole } from "@/lib/roles";

export const metadata = { title: "Team" };
export const dynamic = "force-dynamic";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { session, ops, active, caps } = await requireTenantPage();
  const { request } = await searchParams;

  const [members, invites, roleRequests, myRequest] = await Promise.all([
    listMembers(active.id),
    listPendingInvites(active.id),
    caps.roleCan("team") ? listPendingRoleRequests(active.id) : Promise.resolve([]),
    ops ? Promise.resolve(null) : getOpenRoleRequestForUser(active.id, session.user.id),
  ]);
  const canRequest = !ops && canRequestRoleChange({ role: caps.role, tenantStatus: active.status }).ok;
  // ?request=billing (from the billing explainer) opens the dialog pre-filled.
  const initialRequestRole = canRequest && isAssignableTenantRole(request) && request !== caps.role ? request : undefined;

  return (
    <TeamManager
      tenantId={active.id}
      tenantName={active.name}
      members={members}
      invites={invites}
      canManage={caps.can("team")}
      readOnlyReason={caps.readOnlyReason}
      isOwner={caps.isOwner}
      selfUserId={session.user.id}
      selfRole={caps.role}
      canRequest={canRequest}
      myRequest={myRequest}
      roleRequests={roleRequests}
      canDecide={caps.can("team")}
      initialRequestRole={initialRequestRole}
    />
  );
}
