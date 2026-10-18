"use client";

import { Eye } from "lucide-react";
import { stopImpersonationAction } from "@/modules/access/actions";
import { formatDateTime } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { Button } from "@/components/ui/button";

/** What the shell knows about a view-as session (src/app/(app)/layout.tsx). */
export type ViewingAs = {
  targetId: string;
  targetName: string;
  targetEmail: string;
  /** The ops admin really at the keyboard. */
  actorName: string;
  /** ISO instant the view ends on its own. */
  expiresAt: string;
};

/** Ends the view and hard-navigates: the session cookie changes, so every layout must render again. */
export function useStopViewingAs() {
  const { run, isPending } = useAction();
  async function stop() {
    const res = await run(() => stopImpersonationAction(), { key: "stop-view-as", refresh: false });
    if (res?.ok) window.location.assign(res.redirectTo);
  }
  return { stop, pending: isPending("stop-view-as") };
}

/** Shown above every signed-in page while an ops admin is viewing the Hub as someone else. */
export function ViewAsBanner({ viewingAs }: { viewingAs: ViewingAs }) {
  const { stop, pending } = useStopViewingAs();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning"
    >
      <Eye className="size-4 shrink-0" />
      <span className="flex-1">
        {viewingAs.actorName} viewing as <strong className="font-semibold">{viewingAs.targetName}</strong> ({viewingAs.targetEmail})
        {" · "}read-only{" · "}ends {formatDateTime(viewingAs.expiresAt)}
      </span>
      <Button size="sm" variant="outline" onClick={() => void stop()} disabled={pending}>
        {pending ? "Stopping…" : "Stop viewing"}
      </Button>
    </div>
  );
}
