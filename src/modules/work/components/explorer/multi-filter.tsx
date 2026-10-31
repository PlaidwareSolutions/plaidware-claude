"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type FilterOption = {
  value: string;
  label: string;
  /** Product colour dot. */
  color?: string | null;
  /** Show an initials avatar (people). */
  person?: boolean;
  /** Small grey text after the label (counts, hints). */
  hint?: string;
  /** A leading icon (issue types). */
  icon?: React.ReactNode;
  /** A leading colour square, as a bg-* class (epics). */
  swatch?: string;
};

/** A Jira-style multi-select filter: checkbox list that stays open, with search once the list gets long. */
export function MultiFilter({
  label,
  options,
  selected,
  onChange,
  searchable = options.length > 8,
  emptyText = "Nothing to filter by yet",
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
  /** Shown in the menu when there are no options at all (the filter stays on the toolbar, like Jira's). */
  emptyText?: string;
}) {
  const [query, setQuery] = useState("");
  const shown = query ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())) : options;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const single = selected.length === 1 ? options.find((o) => o.value === selected[0])?.label : null;

  return (
    <DropdownMenu onOpenChange={(open) => !open && setQuery("")}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1 rounded-[3px] px-3 font-medium shadow-none",
            selected.length ? "border-info bg-info/10 text-info hover:bg-info/15 hover:text-info" : "text-foreground",
          )}
        >
          <span className="max-w-40 truncate">{single ? `${label}: ${single}` : label}</span>
          {selected.length > 1 && (
            <Badge className="h-4 min-w-4 rounded-full border-0 bg-info px-1 text-[10px] tabular-nums text-white">{selected.length}</Badge>
          )}
          <ChevronDown className="size-4 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>
        {searchable && (
          <div className="px-1 pb-1">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={`Search ${label.toLowerCase()}…`}
              className="h-7 text-xs"
              aria-label={`Search ${label}`}
            />
          </div>
        )}
        <div className="max-h-72 overflow-y-auto">
          {shown.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.value}
              checked={selected.includes(o.value)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => toggle(o.value)}
              className="gap-2 py-2"
              title={o.label}
            >
              {o.person && <UserAvatar name={o.label} size="sm" className="size-5 shrink-0" />}
              {o.icon}
              {o.swatch && <span className={cn("size-2.5 shrink-0 rounded-[2px]", o.swatch)} />}
              {o.color !== undefined && <span className="size-2.5 shrink-0 rounded-full" style={{ background: o.color ?? "var(--primary)" }} />}
              {/* The name takes the room; a key/hint stays on one line at the right. */}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">{o.hint}</span>}
            </DropdownMenuCheckboxItem>
          ))}
          {shown.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">{options.length ? "No matches" : emptyText}</p>}
        </div>
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])} className="justify-center text-xs text-muted-foreground">
              Clear {label.toLowerCase()}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
