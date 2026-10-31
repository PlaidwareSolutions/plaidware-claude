"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { WorkItemStatus } from "../../contracts";
import { STATUS_LABELS, WORKFLOW } from "../../transitions";

/** Jira's status category colours: grey to do, blue in progress, green done. */
const TONE: Record<WorkItemStatus, string> = {
  backlog: "bg-muted text-foreground hover:bg-muted/80",
  todo: "bg-muted text-foreground hover:bg-muted/80",
  in_progress: "bg-info text-white hover:bg-info/90 dark:text-background",
  in_review: "bg-info text-white hover:bg-info/90 dark:text-background",
  done: "bg-success text-white hover:bg-success/90 dark:text-background",
  canceled: "bg-muted text-muted-foreground hover:bg-muted/80",
};

/** The status control at the top of the issue view (and the list rows): a coloured button; the menu lists the workflow's transitions from here. */
export function StatusButton({
  status,
  onChange,
  disabled,
  size = "default",
  className,
}: {
  status: WorkItemStatus;
  onChange: (s: WorkItemStatus) => void;
  disabled?: boolean;
  size?: "default" | "sm";
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          size={size === "sm" ? "xs" : "sm"}
          className={cn("gap-1 rounded-[3px] font-semibold", size === "sm" && "h-6 px-1.5 text-[11px] uppercase tracking-wide", TONE[status], className)}
          aria-label={`Status: ${STATUS_LABELS[status]}`}
        >
          {STATUS_LABELS[status]}
          <ChevronDown className={size === "sm" ? "size-3" : "size-4"} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {WORKFLOW[status].map((s) => (
          <DropdownMenuItem key={s} onSelect={() => onChange(s)}>
            <StatusBadge kind="workItem" status={s} label={STATUS_LABELS[s]} lozenge />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
