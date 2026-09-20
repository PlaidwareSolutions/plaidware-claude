import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { UserHeader } from "@/modules/access/components/user-header";
import { loadUser } from "./load";

export const dynamic = "force-dynamic";

/** One account: the header + tabs; pages re-run the guard (layouts don't on soft navigation). */
export default async function UserLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await requireOpsPage("support");
  const { id } = await params;
  const user = await loadUser(id);
  if (!user) notFound();

  return (
    <div className="flex flex-col gap-6">
      <UserHeader user={user} selfUserId={session.user.id} />
      {children}
    </div>
  );
}
