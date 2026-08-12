"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Crown, MailPlus, Trash2 } from "lucide-react";
import type { InviteRow, MemberRow } from "../queries";
import {
  cancelInviteAction,
  inviteMemberAction,
  removeMemberAction,
  transferOwnershipAction,
  updateMemberRoleAction,
} from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ASSIGNABLE_ROLES = ["admin", "billing", "member"] as const;

export function TeamManager({
  tenantId,
  tenantName,
  members,
  invites,
  canManage,
  isOwner,
  selfUserId,
}: {
  tenantId: string;
  tenantName: string;
  members: MemberRow[];
  invites: InviteRow[];
  canManage: boolean;
  isOwner: boolean;
  selfUserId: string;
}) {
  const [, startTransition] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<(typeof ASSIGNABLE_ROLES)[number]>("member");
  const [busy, setBusy] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(okMsg);
      else toast.error(res.error ?? "Something went wrong");
    });
  }

  async function sendInvite() {
    setBusy(true);
    const res = await inviteMemberAction({ tenantId, email: inviteEmail, role: inviteRole });
    setBusy(false);
    if (res.ok) {
      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteOpen(false);
      setInviteEmail("");
    } else {
      toast.error(res.error ?? "Invite failed");
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-heading">Team</h1>
          <p className="text-sm text-muted-foreground">
            People with access to {tenantName}.
          </p>
        </div>
        {canManage && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <MailPlus className="size-4" /> Invite member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite a member</DialogTitle>
                <DialogDescription>
                  They&apos;ll receive an email link, valid for 7 days.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as typeof inviteRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin — full workspace access</SelectItem>
                      <SelectItem value="billing">Billing — invoices and payments</SelectItem>
                      <SelectItem value="member">Member — read-only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={sendInvite} disabled={busy || !inviteEmail}>
                  {busy ? "Sending…" : "Send invitation"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden sm:table-cell">Joined</TableHead>
              {canManage && <TableHead className="w-24" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.memberId}>
                <TableCell>
                  <div className="font-medium text-heading">{m.name}</div>
                  <div className="text-xs text-muted-foreground">{m.email}</div>
                </TableCell>
                <TableCell>
                  {m.role === "owner" ? (
                    <Badge className="gap-1">
                      <Crown className="size-3" /> owner
                    </Badge>
                  ) : canManage ? (
                    <Select
                      value={m.role}
                      onValueChange={(role) =>
                        run(
                          () =>
                            updateMemberRoleAction({
                              tenantId,
                              memberId: m.memberId,
                              role: role as (typeof ASSIGNABLE_ROLES)[number],
                            }),
                          `${m.name} is now ${role}`,
                        )
                      }
                    >
                      <SelectTrigger size="sm" className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNABLE_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="secondary">{m.role}</Badge>
                  )}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                  {m.joinedAt.toLocaleDateString()}
                </TableCell>
                {canManage && (
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {isOwner && m.role !== "owner" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Transfer ownership"
                          onClick={() => {
                            if (confirm(`Make ${m.name} the owner of ${tenantName}? You become an admin.`)) {
                              run(() => transferOwnershipAction(tenantId, m.userId), `${m.name} is now the owner`);
                            }
                          }}
                        >
                          <Crown className="size-4" />
                        </Button>
                      )}
                      {m.role !== "owner" && m.userId !== selfUserId && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Remove member"
                          onClick={() => {
                            if (confirm(`Remove ${m.name} from ${tenantName}?`)) {
                              run(() => removeMemberAction(tenantId, m.memberId), `${m.name} removed`);
                            }
                          }}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {invites.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-heading">Pending invitations</h2>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableBody>
                {invites.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <div className="font-medium text-heading">{inv.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {inv.role} · expires {inv.expiresAt.toLocaleDateString()}
                        {inv.inviterName ? ` · invited by ${inv.inviterName}` : ""}
                      </div>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => run(() => cancelInviteAction(tenantId, inv.id), "Invitation revoked")}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
