"use client";

import { useState } from "react";
import { requestRoleChangeAction } from "../actions";
import { ASSIGNABLE_TENANT_ROLES, TENANT_ROLE_META, type AssignableTenantRole } from "@/lib/roles";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** A member asks the workspace owners for a different role. */
export function RoleRequestDialog({
  tenantId,
  currentRole,
  open,
  onOpenChange,
  initialRole,
}: {
  tenantId: string;
  currentRole: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRole?: AssignableTenantRole;
}) {
  const options = ASSIGNABLE_TENANT_ROLES.filter((r) => r !== currentRole);
  const [role, setRole] = useState<AssignableTenantRole>(initialRole ?? options[0] ?? "member");
  const [note, setNote] = useState("");
  const { run, isPending } = useAction();

  async function submit() {
    const res = await run(() => requestRoleChangeAction({ tenantId, role, note: note.trim() || undefined }), {
      key: "request-role",
      success: "Request sent to your workspace owners",
    });
    if (res?.ok) {
      onOpenChange(false);
      setNote("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a role change</DialogTitle>
          <DialogDescription>
            A workspace owner or admin reviews it; you&apos;ll get an email either way.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AssignableTenantRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {options.map((r) => (
                  <SelectItem key={r} value={r}>{TENANT_ROLE_META[r].label} — {TENANT_ROLE_META[r].description}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="role-request-note">Why? (optional)</Label>
            <Textarea
              id="role-request-note"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. I handle the invoices for our team"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={isPending("request-role")}>
            {isPending("request-role") ? "Sending…" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
