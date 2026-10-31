"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Expand, Link2, ListTodo, MoreHorizontal, Settings, Shrink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const FULL = "data-work-fullscreen";

function copyLink(url: string, what: string) {
  void navigator.clipboard.writeText(url).then(
    () => toast.success(`Link to ${what} copied`),
    () => toast.error("Couldn't copy the link"),
  );
}

/** Jira's full screen: the browser goes full screen and the app's sidebar + top bar step aside. Esc leaves. */
function useFullscreen() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => {
      const active = !!document.fullscreenElement;
      if (!active) document.documentElement.removeAttribute(FULL);
      setOn(active);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.documentElement.removeAttribute(FULL);
    };
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    document.documentElement.setAttribute(FULL, "");
    // Fullscreen on the whole document keeps dialogs and menus (portals) visible.
    document.documentElement.requestFullscreen?.().catch(() => {
      // Not allowed (iframe, old browser): still give the board the whole window.
      setOn(true);
    });
  };
  const exitFallback = () => {
    document.documentElement.removeAttribute(FULL);
    setOn(false);
  };
  return { on, toggle: on && !document.fullscreenElement ? exitFallback : toggle };
}

/** The icon row at the top right of a board (share, full screen), as in Jira. */
export function BoardHeaderActions({ label }: { label: string }) {
  const full = useFullscreen();
  const icon = "size-8 rounded-[3px] border";
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="ghost" size="icon" className={icon} title="Share — copy a link to this view" aria-label="Share" onClick={() => copyLink(window.location.href, label)}>
        <Link2 className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(icon, full.on && "border-info bg-info/10 text-info")}
        title={full.on ? "Exit full screen (Esc)" : "Enter full screen"}
        aria-label={full.on ? "Exit full screen" : "Enter full screen"}
        aria-pressed={full.on}
        onClick={full.toggle}
      >
        {full.on ? <Shrink className="size-4" /> : <Expand className="size-4" />}
      </Button>
    </div>
  );
}

/** The ⋯ beside the board title. */
export function BoardTitleMenu({ backlogHref, settingsHref }: { backlogHref?: string; settingsHref?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 rounded-[3px]" aria-label="Board actions">
          <MoreHorizontal className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem onSelect={() => copyLink(window.location.origin + window.location.pathname, "this board")}>
          <Link2 className="size-4" /> Copy board link
        </DropdownMenuItem>
        {backlogHref && (
          <DropdownMenuItem asChild>
            <Link href={backlogHref}>
              <ListTodo className="size-4" /> Go to backlog
            </Link>
          </DropdownMenuItem>
        )}
        {settingsHref && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={settingsHref}>
                <Settings className="size-4" /> Board settings
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
