"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { addStaffAction } from "../actions";
import { STAFF_ROLES, platformRoleChangeConfirm, typedEmailMatches, type StaffRole } from "../rules";
import { PLATFORM_ROLE_META } from "@/lib/roles";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const EMPTY = { firstName: "", lastName: "", email: "", confirmEmail: "" };

/**
 * Ops admins create staff accounts here (developer, ops support, ops admin);
 * the person sets a password from the emailed link. Granting ops admin asks
 * for the email to be typed again, like changing a role to ops admin does.
 */
export function AddStaffDialog() {
  const { run, isPending } = useAction();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<StaffRole>("developer");
  const [form, setForm] = useState(EMPTY);
  const busy = isPending("add-staff");
  const email = form.email.trim().toLowerCase();
  const needsRetype = platformRoleChangeConfirm({ before: "customer", after: role, name: "", email }).typedEmail;
  const ready =
    form.firstName.trim() &&
    form.lastName.trim() &&
    email.includes("@") &&
    (!needsRetype || typedEmailMatches(form.confirmEmail, email));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await run(() => addStaffAction({ firstName: form.firstName, lastName: form.lastName, email, role }), {
      key: "add-staff",
      success: `${PLATFORM_ROLE_META[role].label} account created — set-password link sent to ${email}`,
    });
    if (res?.ok) {
      setOpen(false);
      setForm(EMPTY);
      setRole("developer");
    }
  }

  return (
    <>
      <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" /> Add staff
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Add a staff account</DialogTitle>
              <DialogDescription>
                Two emails go out: a welcome note and a set-password link (valid one hour; magic-link
                sign-in works after that). The role can be changed later from the table.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAFF_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {PLATFORM_ROLE_META[r].label} — {PLATFORM_ROLE_META[r].description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="staff-first">First name</Label>
                <Input
                  id="staff-first"
                  autoFocus
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="staff-last">Last name</Label>
                <Input id="staff-last" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="staff-email">Email</Label>
              <Input
                id="staff-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="name@plaidware.com"
              />
            </div>
            {needsRetype && (
              <div className="grid gap-2">
                <Label htmlFor="staff-confirm">Type the email again to grant ops admin</Label>
                <Input
                  id="staff-confirm"
                  type="email"
                  value={form.confirmEmail}
                  onChange={(e) => setForm({ ...form, confirmEmail: e.target.value })}
                  placeholder={email || "name@plaidware.com"}
                />
              </div>
            )}
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
