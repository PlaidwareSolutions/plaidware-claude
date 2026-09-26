import Link from "next/link";
import { Building2 } from "lucide-react";
import { requireWorkClientsPage } from "@/policy";
import { listClientWorkspaces } from "@/modules/work/queries";
import { WORK } from "@/lib/routes";
import { formatDate } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { DataTableShell } from "@/components/data-table-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Clients · Work" };
export const dynamic = "force-dynamic";

/** A developer's clients: the workspaces an ops admin added them to (ops are sent to /ops/clients). */
export default async function WorkClientsPage() {
  const { viewer } = await requireWorkClientsPage();
  const rows = await listClientWorkspaces(viewer);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clients"
        description="The client workspaces you've been added to — read-only context for the work you do for them."
        meta={`${rows.length} workspace${rows.length === 1 ? "" : "s"}`}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No client workspaces yet"
          description="An ops admin adds you to a client's workspace when you need its context: what they run, who they are and what they asked for. Items from other clients stay unnamed."
        />
      ) : (
        <DataTableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Products</TableHead>
                <TableHead>Open requests</TableHead>
                <TableHead className="hidden md:table-cell">Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={WORK.client(r.id)} className="font-medium text-heading hover:text-primary">
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.slug}</div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="tenant" status={r.status} />
                  </TableCell>
                  <TableCell className="hidden text-sm tabular-nums text-muted-foreground sm:table-cell">{r.products}</TableCell>
                  <TableCell className="text-sm tabular-nums text-heading">{r.openRequests}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{formatDate(r.joinedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableShell>
      )}
    </div>
  );
}
