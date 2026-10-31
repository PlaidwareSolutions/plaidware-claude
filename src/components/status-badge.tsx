import { Badge } from "@/components/ui/badge";
import { statusVariant, type StatusKind } from "@/lib/status-variants";
import { cn } from "@/lib/utils";

/** The only way to render a status pill. Server- and client-safe. */
export function StatusBadge({
  kind,
  status,
  label,
  lozenge,
  className,
}: {
  kind: StatusKind;
  status: string | null | undefined;
  /** Override the derived label (e.g. "dunning · 2 reminders"). */
  label?: React.ReactNode;
  /** Square, bold, uppercase tag (the work boards' Jira-style status). */
  lozenge?: boolean;
  className?: string;
}) {
  const v = statusVariant(kind, status);
  return (
    <Badge
      variant={v.variant}
      className={cn(lozenge && "rounded-[3px] border-0 px-1.5 py-px text-[11px] font-bold uppercase leading-4 tracking-wide", className)}
    >
      {label ?? v.label}
    </Badge>
  );
}
