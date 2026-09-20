import { requireOpsPage } from "@/policy";
import { countOpsAdmins, listPlatformUsers } from "@/modules/access/queries";
import { platformTimeline } from "@/modules/audit/service";
import { AccessTable } from "@/modules/access/components/access-table";
import { ActivityFeed } from "@/modules/audit/components/activity-feed";

export const metadata = { title: "Access · System" };
export const dynamic = "force-dynamic";

export default async function OpsAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; status?: string }>;
}) {
  const session = await requireOpsPage("support");
  const filter = await searchParams;
  const [list, opsAdminCount, timeline] = await Promise.all([
    listPlatformUsers(filter),
    countOpsAdmins(),
    platformTimeline(50),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <AccessTable
        users={list.users}
        hasMore={list.hasMore}
        selfUserId={session.user.id}
        opsAdminCount={opsAdminCount}
        filter={filter}
      />
      <ActivityFeed
        title="Platform activity"
        emptyDescription="Platform role grants and revokes land here, with who did them and when."
        entries={timeline}
      />
    </div>
  );
}
