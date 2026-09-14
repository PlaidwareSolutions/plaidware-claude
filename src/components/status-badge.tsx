import { Badge } from "@/components/ui/badge";
import { statusVariant, type StatusKind } from "@/lib/status-variants";

/** The only way to render a status pill. Server- and client-safe. */
export function StatusBadge({
  kind,
  status,
  label,
  className,
}: {
  kind: StatusKind;
  status: string | null | undefined;
  /** Override the derived label (e.g. "dunning · 2 reminders"). */
  label?: React.ReactNode;
  className?: string;
}) {
  const v = statusVariant(kind, status);
  return (
    <Badge variant={v.variant} className={className}>
      {label ?? v.label}
    </Badge>
  );
}
