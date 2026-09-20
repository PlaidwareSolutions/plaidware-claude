"use client";

import { useState } from "react";
import type { PlatformUserDetail } from "../queries";
import { setAccountDisabledAction } from "../actions";
import { accountDisableConfirm, typedEmailMatches } from "../rules";
import { normalizePlatformRole } from "@/lib/roles";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Disable an account: optional reason for the log, typed email for staff. */
export function DisableAccountDialog({
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
  const [confirmEmail, setConfirmEmail] = useState("");
  const c = accountDisableConfirm({
    name: user.name,
    email: user.email,
    role: normalizePlatformRole(user.platformRole),
    disabled: true,
  });
  const ready = !c.typedEmail || typedEmailMatches(confirmEmail, user.email);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await run(
      () => setAccountDisabledAction({ userId: user.id, disabled: true, reason: reason.trim() || undefined }),
      { key: "disable", success: `${user.name}'s account is disabled` },
    );
    if (res?.ok) {
      onOpenChange(false);
      setReason("");
      setConfirmEmail("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{c.title}</DialogTitle>
            <DialogDescription>{c.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="disable-reason">Reason (optional, kept in the activity log)</Label>
            <Textarea
              id="disable-reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. left the company"
            />
          </div>
          {c.typedEmail && (
            <div className="grid gap-2">
              <Label htmlFor="disable-confirm">Type the email address to confirm</Label>
              <Input
                id="disable-confirm"
                type="email"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder={user.email}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Keep active
            </Button>
            <Button type="submit" variant="destructive" disabled={!ready || isPending("disable")}>
              {isPending("disable") ? "Disabling…" : "Disable account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
