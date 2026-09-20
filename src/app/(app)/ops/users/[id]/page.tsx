import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { countOpsAdmins } from "@/modules/access/queries";
import { UserOverview } from "@/modules/access/components/user-overview";
import { loadUser, userMetadata } from "./load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return userMetadata(params);
}

export default async function UserOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOpsPage("support");
  const { id } = await params;
  const [user, opsAdminCount] = await Promise.all([loadUser(id), countOpsAdmins()]);
  if (!user) notFound();
  return <UserOverview user={user} selfUserId={session.user.id} opsAdminCount={opsAdminCount} />;
}
