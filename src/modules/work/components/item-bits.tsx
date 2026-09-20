import { Bug, CircleArrowUp, Sparkles, SquareCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { WorkItemType } from "../contracts";
import { TYPE_LABELS } from "./labels";

/** Hook-free bits used by both server and client components. */

export const TYPE_ICONS: Record<WorkItemType, LucideIcon> = {
  feature: Sparkles,
  enhancement: CircleArrowUp,
  bug: Bug,
  task: SquareCheck,
};
const TYPE_TONE: Record<WorkItemType, string> = {
  feature: "text-primary",
  enhancement: "text-success",
  bug: "text-destructive",
  task: "text-muted-foreground",
};

export function TypeIcon({ type, className }: { type: WorkItemType; className?: string }) {
  const Icon = TYPE_ICONS[type];
  return <Icon className={cn("size-3.5 shrink-0", TYPE_TONE[type], className)} aria-label={TYPE_LABELS[type]} />;
}

export function LabelChips({ labels, max = 3, className }: { labels: string[]; max?: number; className?: string }) {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, max);
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {shown.map((l) => (
        <Badge key={l} variant="secondary" className="px-1.5 text-[10px] font-normal">
          {l}
        </Badge>
      ))}
      {labels.length > max && <span className="text-[10px] text-muted-foreground">+{labels.length - max}</span>}
    </span>
  );
}
