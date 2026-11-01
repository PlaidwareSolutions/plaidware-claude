"use client";

import { Eye, EyeOff } from "lucide-react";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { setWatchingAction } from "../../actions";
import type { WorkUserRef } from "../../dto";

/**
 * Jira's watch eye: how many people get this issue's emails, who they are, and
 * Start / Stop watching for you. Reporters, assignees, commenters and anyone
 * @mentioned are added automatically.
 */
export function WatchButton({ itemId, watchers, viewer }: { itemId: string; watchers: WorkUserRef[]; viewer: WorkUserRef | null }) {
  const { run, isPending } = useAction();
  const watching = !!viewer && watchers.some((w) => w.id === viewer.id);
  const toggle = () =>
    void run(() => setWatchingAction({ itemId, watching: !watching }), {
      key: "watch",
      refresh: false,
      success: watching ? "You'll stop getting emails about this issue" : "You'll get emails about this issue",
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-8 gap-1.5 rounded-[3px] px-2", watching && "text-info hover:text-info")}
          aria-label={`${watching ? "Watching" : "Not watching"} · ${watchers.length} watcher${watchers.length === 1 ? "" : "s"}`}
          title={watching ? "You're watching this issue" : "Watch this issue"}
        >
          <Eye className={cn("size-4", watching && "fill-info/20")} />
          <span className="text-xs font-semibold tabular-nums">{watchers.length}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={toggle} disabled={isPending("watch")} className="font-medium">
          {watching ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          {watching ? "Stop watching" : "Start watching"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {watchers.length ? `Watching (${watchers.length}) — they get emails about updates` : "No one is watching yet"}
        </DropdownMenuLabel>
        <div className="max-h-60 overflow-y-auto">
          {watchers.map((w) => (
            <div key={w.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
              <UserAvatar name={w.name} size="sm" className="size-5" />
              <span className="truncate">{w.name}</span>
              {viewer?.id === w.id && <span className="ml-auto text-[11px] text-muted-foreground">you</span>}
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
