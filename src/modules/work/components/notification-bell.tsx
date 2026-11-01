"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { WORK, withQuery } from "@/lib/routes";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { markNotificationsReadAction, myNotificationsAction } from "../actions";
import type { WorkNotificationDto } from "../queries";
import { itemRef } from "../explorer-logic";

/** Other parts of the page (opening an item) say the bell is stale with this event. */
export const NOTIFICATIONS_CHANGED = "work-notifications-changed";
const POLL_MS = 30_000;

/**
 * The bell in the top bar: comments, assignments, mentions and changes on
 * items you're assigned, watch, or reported. Polls every 30s and on focus;
 * clicking one opens the item (and reads it); opening an item anywhere reads
 * its notifications too; "Mark all as read" clears the count.
 */
export function NotificationBell() {
  const router = useRouter();
  const { run } = useAction();
  const [items, setItems] = useState<WorkNotificationDto[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await myNotificationsAction();
      if (!res.ok) return;
      setItems(res.items);
      setUnread(res.unread);
      setLoaded(true);
    } catch {
      // Offline or signed out: keep what we have; the next poll retries.
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    window.addEventListener(NOTIFICATIONS_CHANGED, onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onFocus);
    };
  }, [load]);

  async function open(n: WorkNotificationDto) {
    if (!n.read) {
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      void run(() => markNotificationsReadAction({ ids: [n.id] }), { key: "read", refresh: false });
    }
    router.push(withQuery(WORK.board(n.item.slug), { item: itemRef(n.item.slug, n.item.number) }), { scroll: false });
  }

  async function readAll() {
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    setUnread(0);
    await run(() => markNotificationsReadAction({ all: true }), { key: "readAll", refresh: false });
  }

  return (
    <DropdownMenu onOpenChange={(o) => o && void load()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative cursor-pointer" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold tabular-nums text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button type="button" className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-info hover:underline" onClick={() => void readAll()}>
              <CheckCheck className="size-3.5" /> Mark all as read
            </button>
          )}
        </div>
        <ul className="max-h-[min(28rem,70vh)] overflow-y-auto">
          {!loaded && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</li>}
          {loaded && items.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">
              You&apos;re all caught up. Comments, mentions and changes on work you&apos;re assigned, watch or reported show up here.
            </li>
          )}
          {items.map((n) => (
            <li key={n.id} className="border-b last:border-0">
              <button
                type="button"
                className={cn("flex w-full cursor-pointer gap-2.5 px-3 py-2.5 text-left hover:bg-accent", !n.read && "bg-info/5")}
                onClick={() => void open(n)}
              >
                <UserAvatar name={n.actor} size="sm" className="mt-0.5 size-7 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm leading-snug">
                    <span className="font-semibold">{n.actor}</span> {n.summary}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    <span className="font-medium">{n.item.key}</span> {n.item.title}
                  </span>
                  {n.excerpt && <span className="line-clamp-2 text-xs text-foreground/80">“{n.excerpt}”</span>}
                  <span className="text-[11px] text-muted-foreground" title={formatDateTime(n.createdAt)}>
                    {formatRelative(n.createdAt)}
                  </span>
                </span>
                {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-info" aria-label="Unread" />}
              </button>
            </li>
          ))}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Opening an item reads its notifications (Jira clears the bell for what you've seen). */
export function useReadItemNotifications(itemId: string) {
  useEffect(() => {
    let live = true;
    void markNotificationsReadAction({ itemId }).then((r) => {
      if (live && r.ok && r.changed > 0) window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
    });
    return () => {
      live = false;
    };
  }, [itemId]);
}
