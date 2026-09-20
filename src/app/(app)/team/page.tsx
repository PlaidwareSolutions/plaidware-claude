import { requireTenantPage } from "@/policy";
import { listMembers, listPendingInvites } from "@/modules/tenancy/queries";
import { TeamManager } from "@/modules/tenancy/components/team-manager";

export const metadata = { title: "Team" };
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const { session, active, caps } = await requireTenantPage();

  const [members, invites] = await Promise.all([
    listMembers(active.id),
    listPendingInvites(active.id),
  ]);

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
    />
  );
}
