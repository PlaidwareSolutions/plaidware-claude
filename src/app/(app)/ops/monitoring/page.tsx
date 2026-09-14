import { requireOpsPage } from "@/policy";
import { findQuietReporters, getActiveIncidents } from "@/modules/monitoring/service";
import { IncidentsView } from "@/modules/monitoring/components/incidents-view";

export const metadata = { title: "Monitoring" };
export const dynamic = "force-dynamic";

export default async function OpsIncidentsPage() {
  await requireOpsPage();

  const [incidents, quiet] = await Promise.all([getActiveIncidents(), findQuietReporters()]);
  return <IncidentsView incidents={incidents} quiet={quiet} />;
}
