import { notFound } from "next/navigation";
import { isOpsAdmin, requireOpsPage } from "@/policy";
import { listAllTenants, listOpenRoleRequestsForUser, listUserMemberships } from "@/modules/tenancy/queries";
import { UserWorkspaces } from "@/modules/access/components/user-workspaces";
import { loadUser, userMetadata } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return userMetadata(params, "Workspaces");
}

export default async function UserWorkspacesPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOpsPage("support");
  const { id } = await params;
  const user = await loadUser(id);
  if (!user) notFound();
  const [memberships, requests, workspaces] = await Promise.all([
    listUserMemberships(id),
    listOpenRoleRequestsForUser(id),
    // The Add dialog is an ops-admin control; support never gets the list.
    isOpsAdmin(session) ? listAllTenants() : Promise.resolve([]),
  ]);
  return (
    <UserWorkspaces
      user={user}
      memberships={memberships}
      requests={requests}
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, slug: w.slug, status: w.status }))}
    />
  );
}
