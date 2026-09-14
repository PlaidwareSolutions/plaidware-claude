import { requireOpsPage } from "@/policy";
import { getMonitoringBoard } from "@/modules/monitoring/queries";
import { OpsMonitoringBoard } from "@/modules/monitoring/components/ops-monitoring-board";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Monitoring" };
export const dynamic = "force-dynamic";

export default async function OpsMonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; tenant?: string; status?: string; q?: string }>;
}) {
  await requireOpsPage();
  const filter = await searchParams;
  const board = await getMonitoringBoard(filter);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Monitoring"
        description="Incidents, quiet reporters, fleet uptime, SEO, reporter health, and what the worker does next — across every client."
      />
      <OpsMonitoringBoard board={board} />
    </div>
  );
}
