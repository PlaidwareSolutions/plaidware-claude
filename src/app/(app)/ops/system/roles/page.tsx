import { Building2, KeyRound, ShieldCheck, Workflow } from "lucide-react";
import { requireOpsPage } from "@/policy";
import { countUsersByPlatformRole } from "@/modules/access/queries";
import { countMembersByTenantRole } from "@/modules/tenancy/queries";
import { platformRoleMatrix, statusCapabilityMatrixData, tenantRoleMatrix } from "@/lib/role-matrices";
import {
  groupBySurface,
  platformRolesForLevel,
  requirementLabel,
  tenantRolesForCapability,
  type Requirement,
} from "@/lib/permissions-reference";
import { RoleMatrix } from "@/components/role-matrix";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { DataTableShell } from "@/components/data-table-shell";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Roles · System" };
export const dynamic = "force-dynamic";

const AREA_LABEL = { ops: "Ops portal", tenant: "Client workspace", work: "Work area", account: "Own account" } as const;

function RequirementCell({ r }: { r: Requirement }) {
  switch (r.kind) {
    case "ops":
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          {platformRolesForLevel(r.level).map((role) => (
            <StatusBadge key={role} kind="platformRole" status={role} />
          ))}
        </span>
      );
    case "tenant":
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Badge variant="outline" className="font-mono text-[10px]">{r.cap}</Badge>
          {tenantRolesForCapability(r.cap).map((role) => (
            <StatusBadge key={role} kind="tenantRole" status={role} />
          ))}
        </span>
      );
    case "work":
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          {r.manage ? (
            <StatusBadge kind="platformRole" status="ops_admin" />
          ) : (
            <>
              <StatusBadge kind="platformRole" status="developer" />
              <StatusBadge kind="platformRole" status="ops_support" />
              <StatusBadge kind="platformRole" status="ops_admin" />
            </>
          )}
        </span>
      );
    case "signed_in":
      return <span className="text-sm text-muted-foreground">{requirementLabel(r)}</span>;
  }
}

/** Read-only reference: the role tables as matrices plus what each surface requires. */
export default async function OpsRolesPage() {
  await requireOpsPage("support");
  const [platformCounts, tenantCounts] = await Promise.all([countUsersByPlatformRole(), countMembersByTenantRole()]);
  const groups = groupBySurface();

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Platform roles"
        icon={ShieldCheck}
        description="On the account itself. Defined in src/lib/roles.ts; changed from the Access tab."
      >
        <RoleMatrix data={platformRoleMatrix()} counts={platformCounts} caption="Counts are accounts holding the role." />
      </Section>

      <Section
        title="Tenant roles"
        icon={Building2}
        description="On a workspace membership. Owner is unique per workspace and moves only by transfer."
      >
        <RoleMatrix data={tenantRoleMatrix()} counts={tenantCounts} caption="Counts are memberships across all workspaces." />
      </Section>

      <Section
        title="Workspace status"
        icon={Workflow}
        description="A workspace's status narrows what every role can do; ops admins are never gated."
      >
        <RoleMatrix data={statusCapabilityMatrixData()} />
      </Section>

      <Section title="What requires what" icon={KeyRound} description="Descriptive, kept by hand in src/lib/permissions-reference.ts — update it when a guard changes.">
        <DataTableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Area</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Requires</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) =>
                g.entries.map((e, i) => (
                  <TableRow key={`${g.area}|${g.surface}|${e.action}`}>
                    <TableCell className="align-top text-sm">
                      {i === 0 && (
                        <>
                          <div className="font-medium text-heading">{g.surface}</div>
                          <div className="text-xs text-muted-foreground">{AREA_LABEL[g.area]}</div>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      {e.action}
                      {e.note && <div className="text-xs text-muted-foreground">{e.note}</div>}
                    </TableCell>
                    <TableCell className="align-top" title={requirementLabel(e.requires)}>
                      <RequirementCell r={e.requires} />
                    </TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </DataTableShell>
      </Section>
    </div>
  );
}
