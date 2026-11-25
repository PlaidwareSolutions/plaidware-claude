"use client";

import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_SOURCES,
  WORK_ITEM_STATUSES,
  WORK_ITEM_TYPES,
  type WorkItemPriority,
  type WorkItemSource,
  type WorkItemStatus,
  type WorkItemType,
} from "../contracts";
import type { WorkUserRef } from "../dto";
import { STATUS_LABELS } from "../transitions";
import { PriorityIcon, TypeIcon } from "./item-bits";
import { PRIORITY_LABELS, SOURCE_LABELS, TYPE_LABELS } from "./labels";

/** Shared select pickers for work items (client components). */

type SelectProps<T extends string> = {
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
  ariaLabel?: string;
  /** Jira's inline field: no border until hover (the issue view's Details rows). */
  ghost?: boolean;
};

/** Trigger look for inline-edit fields. */
export const GHOST_TRIGGER = "border-transparent bg-transparent shadow-none hover:bg-accent dark:bg-transparent dark:hover:bg-accent data-[state=open]:border-info";

function EnumSelect<T extends string>({
  value,
  options,
  labels,
  render,
  onChange,
  disabled,
  size = "sm",
  className,
  ariaLabel,
  ghost,
}: SelectProps<T> & { options: readonly T[]; labels: Record<T, string>; render?: (o: T) => React.ReactNode }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      <SelectTrigger size={size} className={cn(ghost && GHOST_TRIGGER, className)} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {render ? (
              <span className="inline-flex items-center gap-2">
                {render(o)}
                {labels[o]}
              </span>
            ) : (
              labels[o]
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const TypeSelect = (p: SelectProps<WorkItemType>) => (
  <EnumSelect {...p} options={WORK_ITEM_TYPES} labels={TYPE_LABELS} render={(t) => <TypeIcon type={t} />} ariaLabel={p.ariaLabel ?? "Type"} />
);
export const PrioritySelect = (p: SelectProps<WorkItemPriority>) => (
  <EnumSelect {...p} options={WORK_ITEM_PRIORITIES} labels={PRIORITY_LABELS} render={(x) => <PriorityIcon priority={x} />} ariaLabel={p.ariaLabel ?? "Priority"} />
);
export const SourceSelect = (p: SelectProps<WorkItemSource>) => <EnumSelect {...p} options={WORK_ITEM_SOURCES} labels={SOURCE_LABELS} ariaLabel={p.ariaLabel ?? "Source"} />;
export const StatusSelect = (p: SelectProps<WorkItemStatus>) => <EnumSelect {...p} options={WORK_ITEM_STATUSES} labels={STATUS_LABELS} ariaLabel={p.ariaLabel ?? "Status"} />;

const NONE = "__none";

/** Nullable pickers: Radix Select can't hold an empty value, so "none" is a sentinel. */
export function RefSelect({
  value,
  options,
  noneLabel,
  onChange,
  disabled,
  size = "sm",
  className,
  ariaLabel,
  ghost,
  render,
  renderNone,
}: {
  value: string | null;
  options: { id: string; name: string }[];
  noneLabel: string;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
  ariaLabel?: string;
  ghost?: boolean;
  /** Leading visual per option (an avatar). */
  render?: (o: { id: string; name: string }) => React.ReactNode;
  renderNone?: React.ReactNode;
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger size={size} className={cn(ghost && GHOST_TRIGGER, className)} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          {renderNone ? (
            <span className="inline-flex items-center gap-2">
              {renderNone}
              {noneLabel}
            </span>
          ) : (
            noneLabel
          )}
        </SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {render ? (
              <span className="inline-flex items-center gap-2">
                {render(o)}
                {o.name}
              </span>
            ) : (
              o.name
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const AssigneeSelect = (p: Omit<Parameters<typeof RefSelect>[0], "options" | "noneLabel" | "render" | "renderNone"> & { assignees: WorkUserRef[] }) => (
  <RefSelect
    {...p}
    options={p.assignees}
    noneLabel="Unassigned"
    ariaLabel={p.ariaLabel ?? "Assignee"}
    render={(o) => <UserAvatar name={o.name} size="sm" className="size-5" />}
    renderNone={
      <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <UserRound className="size-3" />
      </span>
    }
  />
);
