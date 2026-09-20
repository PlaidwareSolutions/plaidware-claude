"use client";

import { useState } from "react";
import { Crown, MailPlus, Trash2, Users } from "lucide-react";
import type { InviteRow, MemberRow } from "../queries";
import {
  cancelInviteAction,
  inviteMemberAction,
  removeMemberAction,
  transferOwnershipAction,
  updateMemberRoleAction,
} from "../actions";
import { formatDate } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ASSIGNABLE_TENANT_ROLES, TENANT_ROLE_META, type AssignableTenantRole } from "@/lib/roles";

type Role = AssignableTenantRole;

export function TeamManager({
  tenantId,
  tenantName,
  members,
  invites,
  canManage,
  readOnlyReason = null,
  isOwner,
  selfUserId,
}: {
  tenantId: string;
  tenantName: string;
  members: MemberRow[];
  invites: InviteRow[];
  canManage: boolean;
  /** Set when the workspace status blocks team changes. */
  readOnlyReason?: string | null;
  isOwner: boolean;
  selfUserId: string;
}) {
  const { run, isPending, pending } = useAction();
  const confirm = useConfirm();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");

  async function sendInvite() {
    const res = await run(() => inviteMemberAction({ tenantId, email: inviteEmail, role: inviteRole }), {
      key: "invite",
      success: `Invitation sent to ${inviteEmail}`,
    });
    if (res?.ok) {
      setInviteOpen(false);
      setInviteEmail("");
    }
  }

  async function transfer(m: MemberRow) {
    const ok = await confirm({
      title: `Make ${m.name} the owner of ${tenantName}?`,
      description: "You become an admin. Only the new owner can transfer ownership back.",
      confirmLabel: "Transfer ownership",
    });
    if (ok) void run(() => transferOwnershipAction(tenantId, m.userId), { key: `transfer:${m.userId}`, success: `${m.name} is now the owner` });
  }

  async function remove(m: MemberRow) {
    const ok = await confirm({
      title: `Remove ${m.name} from ${tenantName}?`,
      description: "They lose access immediately; you can invite them again later.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) void run(() => removeMemberAction(tenantId, m.memberId), { key: `remove:${m.memberId}`, success: `${m.name} removed` });
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <PageHeader
        title="Team"
        description={readOnlyReason ?? `People with access to ${tenantName}.`}
        actions={
          canManage ? (
            <Button className="gap-2" onClick={() => setInviteOpen(true)}>
              <MailPlus className="size-4" /> Invite member
            </Button>
          ) : null
        }
      />

      <Section title="Members" icon={Users} count={members.length}>
        <DataTableShell>
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
              {members.length === 0 && <TableEmpty colSpan={canManage ? 4 : 3} icon={Users} title="No members" />}
              {members.map((m) => (
                <TableRow key={m.memberId}>
                  <TableCell>
                    <div className="font-medium text-heading">
                      {m.name}
                      {m.userId === selfUserId && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </TableCell>
                  <TableCell>
                    {m.role === "owner" ? (
                      <StatusBadge kind="tenantRole" status="owner" label={<span className="inline-flex items-center gap-1"><Crown className="size-3" /> owner</span>} />
                    ) : canManage ? (
                      <Select
                        value={m.role}
                        disabled={isPending(`role:${m.memberId}`)}
                        onValueChange={(role) =>
                          void run(() => updateMemberRoleAction({ tenantId, memberId: m.memberId, role: role as Role }), {
                            key: `role:${m.memberId}`,
                            success: `${m.name} is now ${role}`,
                          })
                        }
                      >
                        <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ASSIGNABLE_TENANT_ROLES.map((r) => <SelectItem key={r} value={r}>{TENANT_ROLE_META[r].label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <StatusBadge kind="tenantRole" status={m.role} />
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{formatDate(m.joinedAt)}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {isOwner && m.role !== "owner" && (
                          <Button variant="ghost" size="icon" title="Transfer ownership" disabled={pending} onClick={() => void transfer(m)}>
                            <Crown className="size-4" />
                          </Button>
                        )}
                        {m.role !== "owner" && m.userId !== selfUserId && (
                          <Button variant="ghost" size="icon" title="Remove member" disabled={pending} onClick={() => void remove(m)}>
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
        </DataTableShell>
      </Section>

      {invites.length > 0 && (
        <Section title="Pending invitations" icon={MailPlus} count={invites.length}>
          <div className="flex flex-col gap-2">
            {invites.map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2 text-sm">
                <span className="font-medium text-heading">{inv.email}</span>
                <StatusBadge kind="tenantRole" status={inv.role} />
                <span className="text-xs text-muted-foreground">
                  expires {formatDate(inv.expiresAt)}{inv.inviterName ? ` · invited by ${inv.inviterName}` : ""}
                </span>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    disabled={isPending(`cancel:${inv.id}`)}
                    onClick={() => void run(() => cancelInviteAction(tenantId, inv.id), { key: `cancel:${inv.id}`, success: "Invitation revoked" })}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a member</DialogTitle>
            <DialogDescription>They&apos;ll receive an email link, valid for 7 days.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_TENANT_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{TENANT_ROLE_META[r].label} — {TENANT_ROLE_META[r].description}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={sendInvite} disabled={isPending("invite") || !inviteEmail}>
              {isPending("invite") ? "Sending…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
