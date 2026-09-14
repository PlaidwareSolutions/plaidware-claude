"use client";

import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Better Auth password change; signs out other sessions on success. */
export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (current === next) {
      toast.error("New password must be different from the current one");
      return;
    }
    setBusy(true);
    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Password change failed");
      return;
    }
    toast.success("Password updated — other sessions were signed out");
    setCurrent("");
    setNext("");
  }

  return (
    <form onSubmit={submit} className="grid max-w-sm gap-4">
      <div className="grid gap-2">
        <Label htmlFor="current">Current password</Label>
        <Input id="current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="next">New password (8+ characters)</Label>
        <Input id="next" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <Button type="submit" disabled={busy || !current || next.length < 8} className="w-fit">
        {busy ? "Saving…" : "Update password"}
      </Button>
    </form>
  );
}
