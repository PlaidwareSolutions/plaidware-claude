import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The one empty state. `compact` for inside a table cell; `success` tone for "all clear". */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "muted",
  compact = false,
  className,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "muted" | "success";
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-1.5 py-2" : "gap-2 rounded-lg border border-dashed px-6 py-10",
        className,
      )}
    >
      {Icon && (
        <Icon className={cn("mb-1 size-8", tone === "success" ? "text-success" : "text-muted-foreground opacity-50")} />
      )}
      <div className={cn("text-sm font-medium", tone === "success" ? "text-success" : "text-heading")}>{title}</div>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
