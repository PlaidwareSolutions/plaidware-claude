import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TableCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "./empty-state";

/** The one container for tabular lists: optional toolbar row, the table, optional footer. */
export function DataTableShell({
  toolbar,
  footer,
  children,
  className,
}: {
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card", className)}>
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">{toolbar}</div>}
      {children}
      {footer && <div className="border-t px-3 py-2 text-sm text-muted-foreground">{footer}</div>}
    </div>
  );
}

/** Full-width empty row for a table body. */
export function TableEmpty({
  colSpan,
  icon,
  title,
  description,
  action,
  tone,
}: {
  colSpan: number;
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "muted" | "success";
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="py-10">
        <EmptyState compact icon={icon} title={title} description={description} action={action} tone={tone} />
      </TableCell>
    </TableRow>
  );
}
