import Link from "next/link";
import { ArrowRight, Building2, UserCog } from "lucide-react";
import type { UserMembershipRow, UserRoleRequestRow } from "@/modules/tenancy/queries";
import { OPS } from "@/lib/routes";
import { formatDate, formatRelative } from "@/lib/dates";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** The Workspaces tab of an account: memberships, and role requests waiting on a decision. */
export function UserWorkspaces({
  memberships,
  requests,
}: {
  memberships: UserMembershipRow[];
  requests: UserRoleRequestRow[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <Section title="Workspaces" icon={Building2} count={memberships.length}>
        <DataTableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {memberships.length === 0 && (
                <TableEmpty colSpan={4} icon={Building2} title="No workspace memberships" description="Access comes from workspace memberships; this account has none." />
              )}
              {memberships.map((m) => (
                <TableRow key={m.memberId}>
                  <TableCell>
                    <Link href={OPS.client(m.id)} className="font-medium text-heading hover:text-primary">
                      {m.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{m.slug}</div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="tenant" status={m.status} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="tenantRole" status={m.role} />
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{formatDate(m.joinedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableShell>
      </Section>

      {requests.length > 0 && (
        <Section title="Open role requests" icon={UserCog} count={requests.length} description="Decided from the workspace's People tab.">
          <div className="flex flex-col gap-2">
            {requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2.5 text-sm">
                <Link href={OPS.clientTab(r.tenantId, "people")} className="font-medium text-heading hover:text-primary">
                  {r.tenantName}
                </Link>
                <span className="inline-flex items-center gap-1.5">
                  <StatusBadge kind="tenantRole" status={r.currentRole} />
                  <ArrowRight className="size-3 text-muted-foreground" />
                  <StatusBadge kind="tenantRole" status={r.requestedRole} />
                </span>
                {r.note && <span className="min-w-0 flex-1 truncate italic text-muted-foreground" title={r.note}>“{r.note}”</span>}
                <span className="ml-auto text-xs text-muted-foreground">requested {formatRelative(r.createdAt)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
