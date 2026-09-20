import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { listUserSessions } from "@/modules/access/queries";
import { UserSessions } from "@/modules/access/components/user-sessions";
import { loadUser, userMetadata } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return userMetadata(params, "Sessions");
}

export default async function UserSessionsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOpsPage("support");
  const { id } = await params;
  const user = await loadUser(id);
  if (!user) notFound();
  const sessions = await listUserSessions(id);
  return <UserSessions userId={id} userName={user.name} sessions={sessions} viewerSessionId={session.session.id} />;
}
