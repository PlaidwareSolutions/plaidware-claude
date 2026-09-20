import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { listOpenRoleRequestsForUser, listUserMemberships } from "@/modules/tenancy/queries";
import { UserWorkspaces } from "@/modules/access/components/user-workspaces";
import { loadUser, userMetadata } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return userMetadata(params, "Workspaces");
}

export default async function UserWorkspacesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOpsPage("support");
  const { id } = await params;
  const user = await loadUser(id);
  if (!user) notFound();
  const [memberships, requests] = await Promise.all([listUserMemberships(id), listOpenRoleRequestsForUser(id)]);
  return <UserWorkspaces memberships={memberships} requests={requests} />;
}
