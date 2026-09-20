"use client";

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
import { PRIORITY_LABELS, SOURCE_LABELS, TYPE_LABELS } from "./labels";

/** Shared select pickers for work items (client components). */

type SelectProps<T extends string> = {
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
  ariaLabel?: string;
};

function EnumSelect<T extends string>({
  value,
  options,
  labels,
  onChange,
  disabled,
  size = "sm",
  className,
  ariaLabel,
}: SelectProps<T> & { options: readonly T[]; labels: Record<T, string> }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      <SelectTrigger size={size} className={className} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {labels[o]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const TypeSelect = (p: SelectProps<WorkItemType>) => <EnumSelect {...p} options={WORK_ITEM_TYPES} labels={TYPE_LABELS} ariaLabel={p.ariaLabel ?? "Type"} />;
export const PrioritySelect = (p: SelectProps<WorkItemPriority>) => <EnumSelect {...p} options={WORK_ITEM_PRIORITIES} labels={PRIORITY_LABELS} ariaLabel={p.ariaLabel ?? "Priority"} />;
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
}: {
  value: string | null;
  options: { id: string; name: string }[];
  noneLabel: string;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger size={size} className={className} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const AssigneeSelect = (p: Omit<Parameters<typeof RefSelect>[0], "options" | "noneLabel"> & { assignees: WorkUserRef[] }) => (
  <RefSelect {...p} options={p.assignees} noneLabel="Unassigned" ariaLabel={p.ariaLabel ?? "Assignee"} />
);
