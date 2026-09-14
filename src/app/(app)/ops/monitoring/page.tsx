import { requireOpsPage } from "@/policy";
import { findQuietReporters, getActiveIncidents } from "@/modules/monitoring/service";
import { getTenant } from "@/modules/tenancy/queries";
import { IncidentsView } from "@/modules/monitoring/components/incidents-view";
import { PageHeader } from "@/components/page-header";
import { FilterChip } from "@/components/filter-chip";
import { OPS } from "@/lib/routes";

export const metadata = { title: "Monitoring" };
export const dynamic = "force-dynamic";

export default async function OpsMonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  await requireOpsPage();

  const { tenant: tenantId } = await searchParams;
  const [incidents, quiet, tenant] = await Promise.all([
    getActiveIncidents(),
    findQuietReporters(),
    tenantId ? getTenant(tenantId) : Promise.resolve(null),
  ]);
  const scoped = tenant ? { id: tenant.id, name: tenant.name } : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Monitoring"
        description="Active incidents and reporters that have gone quiet, across every client."
        actions={scoped && <FilterChip label={`Client: ${scoped.name}`} clearHref={OPS.monitoring} />}
      />
      <IncidentsView
        incidents={scoped ? incidents.filter((i) => i.tenantId === scoped.id) : incidents}
        quiet={scoped ? quiet.filter((q) => q.tenantId === scoped.id) : quiet}
      />
    </div>
  );
}
