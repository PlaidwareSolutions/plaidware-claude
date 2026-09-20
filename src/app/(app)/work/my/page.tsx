import Link from "next/link";
import { Check } from "lucide-react";
import { requireWorkPage, workViewer } from "@/policy";
import { listMyWork } from "@/modules/work/queries";
import { WORK } from "@/lib/routes";
import { formatDay, formatRelative } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { DataTableShell } from "@/components/data-table-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "My work" };
export const dynamic = "force-dynamic";

export default async function MyWorkPage() {
  const session = await requireWorkPage();
  const groups = await listMyWork(workViewer(session));
  const total = groups.reduce((s, g) => s + g.cards.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My work" description="Everything assigned to you, across every product." meta={`${total} open`} />
      {groups.length === 0 ? (
        <EmptyState tone="success" icon={Check} title="Nothing assigned to you" description="Items assigned to you on any board show up here, in progress first." />
      ) : (
        groups.map((g) => (
          <Section
            key={g.product.id}
            title={g.product.name}
            count={g.cards.length}
            actions={
              <Link href={WORK.board(g.product.slug)} className="text-sm text-muted-foreground hover:text-primary">
                Open board →
              </Link>
            }
          >
            <DataTableShell>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Key</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Type</TableHead>
                    <TableHead className="hidden sm:table-cell">Priority</TableHead>
                    <TableHead className="hidden md:table-cell">Points</TableHead>
                    <TableHead className="hidden md:table-cell">Due</TableHead>
                    <TableHead className="hidden lg:table-cell">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.cards.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        <Link href={WORK.item(g.product.slug, c.number)} className="hover:text-primary">{c.key}</Link>
                      </TableCell>
                      <TableCell>
                        <Link href={WORK.item(g.product.slug, c.number)} className="font-medium text-heading hover:text-primary">{c.title}</Link>
                      </TableCell>
                      <TableCell><StatusBadge kind="workItem" status={c.status} /></TableCell>
                      <TableCell className="hidden sm:table-cell"><StatusBadge kind="workType" status={c.type} /></TableCell>
                      <TableCell className="hidden sm:table-cell"><StatusBadge kind="workPriority" status={c.priority} /></TableCell>
                      <TableCell className="hidden text-sm tabular-nums text-muted-foreground md:table-cell">{c.estimatePoints ?? "—"}</TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{c.dueOn ? formatDay(c.dueOn) : "—"}</TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{formatRelative(c.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DataTableShell>
          </Section>
        ))
      )}
    </div>
  );
}
