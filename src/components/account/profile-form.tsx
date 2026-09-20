"use client";

import { useState } from "react";
import { updateProfileAction } from "@/modules/account/actions";
import { useAction } from "@/lib/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Values = { firstName: string; lastName: string; phone: string };

/** Name and phone, editable by the person themselves. */
export function ProfileForm({ initial, phoneIsPlaceholder }: { initial: Values; phoneIsPlaceholder: boolean }) {
  const start = { ...initial, phone: phoneIsPlaceholder ? "" : initial.phone };
  const [form, setForm] = useState<Values>(start);
  const [saved, setSaved] = useState<Values>(start);
  const { run, isPending } = useAction();
  const dirty = form.firstName !== saved.firstName || form.lastName !== saved.lastName || form.phone !== saved.phone;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await run(() => updateProfileAction(form), { key: "profile", success: "Profile updated" });
    if (res?.ok) setSaved(form);
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="profile-first">First name</Label>
          <Input id="profile-first" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="profile-last">Last name</Label>
          <Input id="profile-last" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="profile-phone">Phone</Label>
        <Input
          id="profile-phone"
          type="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="+1 555 123 4567"
        />
        {phoneIsPlaceholder && !form.phone && (
          <p className="text-xs text-warning">Not on file yet — add a number where Plaidware can reach you.</p>
        )}
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!dirty || isPending("profile")}>
          {isPending("profile") ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
