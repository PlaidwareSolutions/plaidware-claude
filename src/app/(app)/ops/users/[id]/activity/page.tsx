import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { userTimeline } from "@/modules/audit/service";
import { ActivityFeed } from "@/modules/audit/components/activity-feed";
import { loadUser, userMetadata } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return userMetadata(params, "Activity");
}

export default async function UserActivityPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOpsPage("support");
  const { id } = await params;
  const user = await loadUser(id);
  if (!user) notFound();
  const entries = await userTimeline(id, 200);
  return (
    <ActivityFeed
      title="Activity"
      emptyDescription="What this person did, and what was done to their account, across every workspace."
      entries={entries}
    />
  );
}
