import { redirect } from "next/navigation";
import { getSession, isOps } from "@/policy";
import { findQuietReporters, getActiveIncidents } from "@/modules/monitoring/service";
import { IncidentsView } from "@/modules/monitoring/components/incidents-view";

export const metadata = { title: "Incidents" };
export const dynamic = "force-dynamic";

export default async function OpsIncidentsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOps(session)) redirect("/dashboard");

  const [incidents, quiet] = await Promise.all([getActiveIncidents(), findQuietReporters()]);
  return <IncidentsView incidents={incidents} quiet={quiet} />;
}
