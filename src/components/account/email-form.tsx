"use client";

import { useState } from "react";
import { requestEmailChangeAction } from "@/modules/account/actions";
import { useAction } from "@/lib/use-action";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Current email with a change flow: one confirmation link goes to the new address. */
export function EmailForm({ email, emailVerified }: { email: string; emailVerified: boolean }) {
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { run, isPending } = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const target = newEmail.trim().toLowerCase();
    const res = await run(() => requestEmailChangeAction({ newEmail: target }), { key: "email", refresh: false });
    if (res?.ok) {
      setSentTo(target);
      setEditing(false);
      setNewEmail("");
    }
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-heading">
        {email}
        <StatusBadge kind="verification" status={emailVerified ? "verified" : "pending"} className="text-[10px]" />
        {!editing && !sentTo && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setEditing(true)}>
            Change email
          </Button>
        )}
      </div>
      {sentTo && (
        <p className="text-muted-foreground">
          If <strong className="text-heading">{sentTo}</strong> can be used, a confirmation link is on its way there (valid 24 hours).
          You keep signing in as <strong className="text-heading">{email}</strong> until you confirm it.{" "}
          <button type="button" className="text-primary hover:underline" onClick={() => setSentTo(null)}>
            Use a different address
          </button>
        </p>
      )}
      {editing && (
        <form onSubmit={submit} className="grid gap-2">
          <Label htmlFor="new-email">New email address</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="new-email"
              type="email"
              autoFocus
              className="max-w-sm flex-1"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <Button type="submit" disabled={!newEmail.includes("@") || isPending("email")}>
              {isPending("email") ? "Sending…" : "Send confirmation link"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
