"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { addDeveloperAction } from "../actions";
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

const EMPTY = { firstName: "", lastName: "", email: "" };

/** Ops admins create developer accounts here; the developer sets a password from the emailed link. */
export function AddDeveloperDialog() {
  const { run, isPending } = useAction();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const busy = isPending("add-developer");
  const ready = form.firstName.trim() && form.lastName.trim() && form.email.includes("@");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const email = form.email.trim().toLowerCase();
    const res = await run(() => addDeveloperAction({ ...form, email }), {
      key: "add-developer",
      success: `Developer account created — set-password link sent to ${email}`,
    });
    if (res?.ok) {
      setOpen(false);
      setForm(EMPTY);
    }
  }

  return (
    <>
      <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" /> Add developer
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Add a developer</DialogTitle>
              <DialogDescription>
                They get the work area only — no clients, billing or monitoring. Two emails go out: a
                welcome note and a set-password link (valid one hour; magic-link sign-in works after that).
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="dev-first">First name</Label>
                <Input
                  id="dev-first"
                  autoFocus
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dev-last">Last name</Label>
                <Input id="dev-last" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dev-email">Email</Label>
              <Input
                id="dev-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="dev@plaidware.com"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !ready}>
                {busy ? "Creating…" : "Create account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
