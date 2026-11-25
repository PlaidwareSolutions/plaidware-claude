"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, Kanban, LayoutGrid } from "lucide-react";
import { WORK } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WorkBoardNav } from "@/components/work-nav";

/** The board a work path belongs to: "/work/fixorata/backlog" → "fixorata" (null on /work, /work/all, /work/my…). */
export function currentBoardSlug(pathname: string, boards: WorkBoardNav[]): string | null {
  const seg = pathname.startsWith(WORK.home + "/") ? pathname.slice(WORK.home.length + 1).split("/")[0] : "";
  return boards.some((b) => b.slug === seg) ? seg : null;
}

/** Coloured square with the board's first letter — Jira's project avatar. */
function ProjectTile({ board, className }: { board: WorkBoardNav | null; className?: string }) {
  return (
    <span
      className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-[4px] text-[11px] font-bold text-white", !board && "bg-info", className)}
      style={board ? { background: board.color ?? "var(--primary)" } : undefined}
      aria-hidden
    >
      {board ? board.name[0]?.toUpperCase() : <LayoutGrid className="size-3.5" />}
    </span>
  );
}

/**
 * Jira's project switcher at the top of the work sidebar: shows where you
 * are, and swaps between "All spaces" (the cross-company board) and one
 * company's board — instead of listing every board in the nav.
 */
export function WorkProjectSwitcher({ boards, pathname, onNavigate }: { boards: WorkBoardNav[]; pathname: string; onNavigate?: () => void }) {
  const [query, setQuery] = useState("");
  const slug = currentBoardSlug(pathname, boards);
  const current = boards.find((b) => b.slug === slug) ?? null;
  const shown = query ? boards.filter((b) => `${b.name} ${b.keyPrefix}`.toLowerCase().includes(query.toLowerCase())) : boards;

  return (
    <DropdownMenu onOpenChange={(open) => !open && setQuery("")}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mb-2 flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
          aria-label="Switch space"
        >
          <ProjectTile board={current} className="size-8 text-sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{current?.name ?? "All spaces"}</span>
            <span className="block truncate text-xs text-muted-foreground">{current ? `${current.keyPrefix} · Software project` : `${boards.length} boards`}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <div className="p-1">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Search spaces"
            className="h-8"
            aria-label="Search spaces"
          />
        </div>
        {!query && (
          <>
            <DropdownMenuItem asChild>
              <Link href={WORK.all} onClick={onNavigate} className="gap-2.5">
                <ProjectTile board={null} />
                <span className="flex-1">All spaces</span>
                {!current && <Check className="size-4 text-info" />}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Spaces</DropdownMenuLabel>
        <div className="max-h-80 overflow-y-auto">
          {shown.map((b) => (
            <DropdownMenuItem key={b.slug} asChild>
              <Link href={WORK.board(b.slug)} onClick={onNavigate} className="gap-2.5">
                <ProjectTile board={b} />
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                {b.slug === slug ? <Check className="size-4 text-info" /> : <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">{b.keyPrefix}</span>}
              </Link>
            </DropdownMenuItem>
          ))}
          {shown.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">No spaces match</p>}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={WORK.home} onClick={onNavigate} className="gap-2.5 text-muted-foreground">
            <Kanban className="size-4" /> View all boards
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
