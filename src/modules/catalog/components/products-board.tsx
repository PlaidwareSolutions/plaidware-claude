import Link from "next/link";
import { Package } from "lucide-react";
import type { ProductBoardRow } from "../queries";
import { formatCents } from "@/lib/money";
import { OPS, withQuery } from "@/lib/routes";
import { StatusBadge } from "@/components/status-badge";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Server component: every product with what it bills, who it serves, and how it is doing. */
export function ProductsBoard({ rows }: { rows: ProductBoardRow[] }) {
  return (
    <DataTableShell footer={`${rows.length} product${rows.length === 1 ? "" : "s"} · hidden products stay out of the catalog but keep billing existing subscribers.`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>Pricing</TableHead>
            <TableHead className="hidden sm:table-cell">Components</TableHead>
            <TableHead className="hidden md:table-cell">KPIs</TableHead>
            <TableHead className="text-right">Subscribers</TableHead>
            <TableHead className="hidden lg:table-cell">Health</TableHead>
            <TableHead className="hidden text-right xl:table-cell">Margin MTD</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableEmpty colSpan={7} icon={Package} title="No products yet" description="Create a product, add its pricing components, then make it visible." />
          )}
          {rows.map((p) => (
            <TableRow key={p.id} className={p.isActive ? undefined : "opacity-70"}>
              <TableCell>
                <Link href={OPS.product(p.id)} className="flex items-center gap-2 font-medium text-heading hover:text-primary">
                  <span className="size-2 rounded-full" style={{ background: p.color ?? "var(--primary)" }} />
                  {p.name}
                </Link>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {p.slug}
                  <Badge variant="secondary" className="text-[9px]">{p.category}</Badge>
                  {!p.isActive && <StatusBadge kind="product" status="hidden" className="text-[9px]" />}
                  {p.isMarketing && <Badge variant="outline" className="text-[9px]">MHub</Badge>}
                </div>
              </TableCell>
              <TableCell>
                <Link href={OPS.productTab(p.id, "pricing")} className="hover:text-primary">
                  <div className="text-sm tabular-nums text-heading">{p.baseCharge ?? <span className="text-warning">no main charge</span>}</div>
                  {p.monthlyFromCents > 0 && <div className="text-xs text-muted-foreground">{formatCents(p.monthlyFromCents)}/mo all recurring</div>}
                </Link>
              </TableCell>
              <TableCell className="hidden tabular-nums sm:table-cell">
                <Link href={OPS.productTab(p.id, "pricing")} className="hover:text-primary">
                  {p.componentsActive}
                  {p.componentsTotal !== p.componentsActive && <span className="text-xs text-muted-foreground"> / {p.componentsTotal}</span>}
                </Link>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Link href={OPS.productTab(p.id, "kpis")} className="hover:text-primary">
                  {p.kpiCount > 0 ? (
                    <span className="tabular-nums">{p.kpiCount}</span>
                  ) : p.isMarketing ? (
                    <span className="text-xs text-muted-foreground">MHub-side</span>
                  ) : (
                    <Badge variant="warning" className="text-[10px]">none</Badge>
                  )}
                </Link>
              </TableCell>
              <TableCell className="text-right">
                <Link href={OPS.productTab(p.id, "subscribers")} className="hover:text-primary">
                  <div className="tabular-nums">{p.liveSubscribers}</div>
                  {p.mrrCents > 0 && <div className="text-xs text-muted-foreground">{formatCents(p.mrrCents)} MRR</div>}
                </Link>
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Link href={withQuery(OPS.monitoring, { product: p.slug })} className="hover:text-primary">
                  {p.openIncidents > 0 ? (
                    <StatusBadge kind="health" status="down" label={`${p.openIncidents} incident${p.openIncidents === 1 ? "" : "s"}`} />
                  ) : p.liveSubscribers > 0 ? (
                    <StatusBadge kind="health" status="healthy" />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </Link>
              </TableCell>
              <TableCell className="hidden text-right tabular-nums xl:table-cell">
                <Link href={OPS.costs} className="hover:text-primary">
                  {p.marginPct != null ? (
                    <span className={p.marginPct >= 70 ? "text-success" : p.marginPct >= 40 ? "text-warning" : "text-destructive"}>{p.marginPct}%</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{p.revenueMtdCents > 0 ? "no cost data" : "—"}</span>
                  )}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataTableShell>
  );
}
