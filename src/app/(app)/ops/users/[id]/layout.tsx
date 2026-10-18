import { notFound } from "next/navigation";
import { impersonationOf, requireOpsPage } from "@/policy";
import { normalizePlatformRole } from "@/lib/roles";
import { canImpersonate } from "@/modules/access/rules";
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
  const viewAs = canImpersonate({
    actorUserId: session.user.id,
    actorRole: normalizePlatformRole(session.user.platformRole),
    actorImpersonating: !!impersonationOf(session),
    targetUserId: user.id,
    targetRole: normalizePlatformRole(user.platformRole),
    targetDisabled: !!user.disabledAt,
  });

  return (
    <div className="flex flex-col gap-6">
      <UserHeader user={user} selfUserId={session.user.id} viewAs={viewAs} />
      {children}
    </div>
  );
}
