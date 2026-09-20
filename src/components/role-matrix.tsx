import { Check, Minus } from "lucide-react";
import type { MatrixData } from "@/lib/role-matrices";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * A role × capability grid. Pure (no hooks, no "use client"), so both the
 * ops reference page and the tenant Team page can render it.
 */
export function RoleMatrix({
  data,
  caption,
  highlightRow,
  counts,
  className,
}: {
  data: MatrixData;
  caption?: string;
  /** Row key to emphasise (the viewer's own role). */
  highlightRow?: string | null;
  /** Row key → how many people hold it. */
  counts?: Record<string, number>;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto rounded-lg border bg-card", className)}>
      <Table>
        {caption && <caption className="px-4 py-2 text-left text-xs text-muted-foreground">{caption}</caption>}
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-48">Role</TableHead>
            {data.columns.map((c) => (
              <TableHead key={c.key} className="text-center" title={c.description}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((r) => {
            const on = new Set(data.cells[r.key] ?? []);
            const mine = highlightRow === r.key;
            return (
              <TableRow key={r.key} className={mine ? "bg-primary/5" : undefined}>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium text-heading">
                    {r.label}
                    {mine && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                    {counts && counts[r.key] != null && (
                      <Badge variant="outline" className="text-[10px] tabular-nums">{counts[r.key]}</Badge>
                    )}
                  </div>
                  {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                </TableCell>
                {data.columns.map((c) => (
                  <TableCell key={c.key} className="text-center">
                    {on.has(c.key) ? (
                      <>
                        <Check className="mx-auto size-4 text-success" aria-hidden />
                        <span className="sr-only">{r.label} can {c.label}</span>
                      </>
                    ) : (
                      <>
                        <Minus className="mx-auto size-4 text-muted-foreground/50" aria-hidden />
                        <span className="sr-only">{r.label} cannot {c.label}</span>
                      </>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
