"use client";

import { useState } from "react";
import type { PlatformUserDetail } from "../queries";
import { startImpersonationAction } from "../actions";
import { IMPERSONATION_REASON_MAX, IMPERSONATION_REASON_MIN } from "@/policy/impersonation";
import { useAction } from "@/lib/use-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Start viewing the Hub as this account: read-only, one hour, reason kept in the log. */
export function ImpersonateDialog({
  user,
  open,
  onOpenChange,
}: {
  user: PlatformUserDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { run, isPending } = useAction();
  const [reason, setReason] = useState("");
  const ready = reason.trim().length >= IMPERSONATION_REASON_MIN;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await run(() => startImpersonationAction({ userId: user.id, reason: reason.trim() }), {
      key: "view-as",
      refresh: false,
    });
    // A full navigation: the session cookie just changed, so every layout must render again.
    if (res?.ok) window.location.assign(res.redirectTo);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>View as {user.name}?</DialogTitle>
            <DialogDescription>
              You&apos;ll see the Hub exactly as {user.email} does, read-only, for one hour. Every change is refused until you
              stop viewing. The reason is kept in the activity log.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="view-as-reason">Reason</Label>
            <Textarea
              id="view-as-reason"
              rows={2}
              autoFocus
              required
              minLength={IMPERSONATION_REASON_MIN}
              maxLength={IMPERSONATION_REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. ticket #123 — client reports a blank billing page"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || isPending("view-as")}>
              {isPending("view-as") ? "Starting…" : `View as ${user.firstName}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
