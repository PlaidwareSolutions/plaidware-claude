import { redirect } from "next/navigation";
import { getSession, roleHasCapability } from "@/policy";
import {
  getUserTenants,
  listMembers,
  listPendingInvites,
} from "@/modules/tenancy/queries";
import { TeamManager } from "@/modules/tenancy/components/team-manager";

export default async function TeamPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const tenants = await getUserTenants(session.user.id);
  const active =
    tenants.find((t) => t.id === session.session.activeOrganizationId) ?? tenants[0];
  if (!active) redirect("/dashboard");

  const [members, invites] = await Promise.all([
    listMembers(active.id),
    listPendingInvites(active.id),
  ]);

  const canManage = roleHasCapability(active.role, "team");
  const isOwner = active.role === "owner";

  return (
    <TeamManager
      tenantId={active.id}
      tenantName={active.name}
      members={members}
      invites={invites}
      canManage={canManage}
      isOwner={isOwner}
      selfUserId={session.user.id}
    />
  );
}
