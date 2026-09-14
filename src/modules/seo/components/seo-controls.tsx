"use client";

import { clearSeoSnoozeAction, runSeoRecheckAction, snoozeSeoAction } from "../actions";
import { formatDate } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { Button } from "@/components/ui/button";

/** Ops-only SEO controls: run an audit now, snooze alerts, clear a snooze. Shared by the panel and the board. */
export function SeoControls({
  subscriptionId,
  strategy,
  snoozedUntil,
  compact = false,
}: {
  subscriptionId: string;
  strategy: "mobile" | "desktop";
  snoozedUntil: string | null;
  compact?: boolean;
}) {
  const { run, isPending } = useAction();
  const key = (k: string) => `${k}:${subscriptionId}:${strategy}`;
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        disabled={isPending(key("recheck"))}
        onClick={() => void run(() => runSeoRecheckAction(subscriptionId), { key: key("recheck"), success: "Audit complete" })}
      >
        {isPending(key("recheck")) ? "Auditing…" : "Run now"}
      </Button>
      {snoozedUntil ? (
        <>
          <span>snoozed until {formatDate(snoozedUntil)}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={isPending(key("clear"))}
            onClick={() => void run(() => clearSeoSnoozeAction(subscriptionId, strategy), { key: key("clear"), success: "Snooze cleared — alerts resume with the next sweep" })}
          >
            Clear
          </Button>
        </>
      ) : (
        <>
          {!compact && <span>Snooze:</span>}
          {[1, 3, 7].map((d) => (
            <Button
              key={d}
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={isPending(key(`snooze${d}`))}
              onClick={() =>
                void run(() => snoozeSeoAction(subscriptionId, strategy, d as 1 | 3 | 7), {
                  key: key(`snooze${d}`),
                  success: `Alerts snoozed ${d}d — a sharper regression still pages`,
                })
              }
            >
              {d}d
            </Button>
          ))}
        </>
      )}
    </span>
  );
}
