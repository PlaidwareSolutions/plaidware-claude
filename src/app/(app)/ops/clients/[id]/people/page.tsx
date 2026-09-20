import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { listMembers, listPendingInvites } from "@/modules/tenancy/queries";
import { ClientPeople } from "@/modules/tenancy/components/client-people";
import { loadClient, clientMetadata } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return clientMetadata(params, "People");
}

export default async function ClientPeoplePage({ params }: { params: Promise<{ id: string }> }) {
  await requireOpsPage("support");
  const { id } = await params;
  const client = await loadClient(id);
  if (!client) notFound();

  const [members, invites] = await Promise.all([listMembers(id), listPendingInvites(id)]);
  return (
    <ClientPeople
      tenant={{ id: client.id, name: client.name, status: client.status }}
      members={members}
      invites={invites}
    />
  );
}
