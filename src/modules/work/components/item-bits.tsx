import { ArrowUp, Bookmark, Bug, Check, ChevronDown, ChevronUp, ChevronsUp, Equal, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { WorkItemPriority, WorkItemType } from "../contracts";
import { PRIORITY_LABELS, TYPE_LABELS } from "./labels";

/** Hook-free bits used by both server and client components. */

export const TYPE_ICONS: Record<WorkItemType, LucideIcon> = {
  feature: Bookmark,
  enhancement: ArrowUp,
  bug: Bug,
  task: Check,
  epic: Zap,
};
/** Jira's issue-type icons: coloured tiles with a white glyph; a bug is a bare red bug. */
const TYPE_TILE: Record<WorkItemType, string | null> = {
  feature: "bg-success",
  enhancement: "bg-primary",
  bug: null,
  task: "bg-info",
  epic: "bg-[color-mix(in_oklab,var(--primary)_80%,var(--coral))]",
};
const TYPE_GLYPH_FILL: Record<WorkItemType, boolean> = { feature: true, enhancement: false, bug: false, task: false, epic: true };

export function TypeIcon({ type, className }: { type: WorkItemType; className?: string }) {
  const Icon = TYPE_ICONS[type];
  if (!TYPE_TILE[type]) {
    return (
      <span className={cn("inline-flex size-4 shrink-0 items-center justify-center text-destructive", className)} role="img" aria-label={TYPE_LABELS[type]} title={TYPE_LABELS[type]}>
        <Icon className="size-4" strokeWidth={2.25} />
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] text-white", TYPE_TILE[type], className)}
      role="img"
      aria-label={TYPE_LABELS[type]}
      title={TYPE_LABELS[type]}
    >
      <Icon className={cn("size-2.5", TYPE_GLYPH_FILL[type] && "fill-current")} strokeWidth={3} />
    </span>
  );
}

const PRIORITY_ICON: Record<WorkItemPriority, { icon: LucideIcon; tone: string }> = {
  urgent: { icon: ChevronsUp, tone: "text-destructive" },
  high: { icon: ChevronUp, tone: "text-coral" },
  medium: { icon: Equal, tone: "text-warning" },
  low: { icon: ChevronDown, tone: "text-info" },
};

/** Jira's priority glyphs: ⇈ urgent, ˄ high, = medium, ˅ low. */
export function PriorityIcon({ priority, className }: { priority: WorkItemPriority; className?: string }) {
  const { icon: Icon, tone } = PRIORITY_ICON[priority];
  const label = `${PRIORITY_LABELS[priority]} priority`;
  return (
    <span className={cn("inline-flex shrink-0", tone, className)} role="img" aria-label={label} title={label}>
      <Icon className="size-4" strokeWidth={2.5} />
    </span>
  );
}

/** Story-point estimate as Jira's grey counter ("-" when unestimated, with showEmpty). */
export function PointsPill({ points, className, showEmpty }: { points: number | null; className?: string; showEmpty?: boolean }) {
  if (points == null && !showEmpty) return null;
  return (
    <span
      className={cn("inline-flex h-4 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground", className)}
      title={points == null ? "Not estimated" : `${points} story point${points === 1 ? "" : "s"}`}
    >
      {points ?? "-"}
    </span>
  );
}

export function LabelChips({ labels, max = 3, className }: { labels: string[]; max?: number; className?: string }) {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, max);
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {shown.map((l) => (
        <Badge key={l} variant="secondary" className="rounded-[3px] border-0 px-1 py-0 text-[11px] font-semibold uppercase leading-4">
          {l}
        </Badge>
      ))}
      {labels.length > max && <span className="text-[11px] text-muted-foreground">+{labels.length - max}</span>}
    </span>
  );
}

/** Epic colours: a stable pick per epic from the theme palette (Jira gives every epic a colour). */
const EPIC_TONES = [
  { dot: "bg-success", ring: "border-success/40" },
  { dot: "bg-warning", ring: "border-warning/40" },
  { dot: "bg-info", ring: "border-info/40" },
  { dot: "bg-primary", ring: "border-primary/40" },
  { dot: "bg-coral", ring: "border-coral/40" },
  { dot: "bg-destructive", ring: "border-destructive/40" },
] as const;
export function epicTone(epicId: string) {
  let h = 0;
  for (const c of epicId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return EPIC_TONES[h % EPIC_TONES.length];
}

/** Jira's epic lozenge on a card: colour square + epic name, outlined. */
export function EpicLozenge({ epic, className }: { epic: { id: string; key: string; title: string }; className?: string }) {
  const tone = epicTone(epic.id);
  return (
    <span
      className={cn("inline-flex max-w-full items-center gap-1.5 rounded-[3px] border bg-background px-1.5 py-px text-xs text-foreground", tone.ring, className)}
      title={`Epic ${epic.key}: ${epic.title}`}
    >
      <span className={cn("size-2.5 shrink-0 rounded-[2px]", tone.dot)} aria-hidden />
      <span className="truncate">{epic.title}</span>
    </span>
  );
}
