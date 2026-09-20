"use client";

import { useState } from "react";
import Link from "next/link";
import { Crown, MailPlus, Phone, Trash2, Users } from "lucide-react";
import type { InviteRow, MemberRow, RoleRequestRow } from "../queries";
import {
  cancelInviteAction,
  inviteMemberAction,
  opsSetUserPhoneAction,
  removeMemberAction,
  resendInviteAction,
  transferOwnershipAction,
  updateMemberRoleAction,
} from "../actions";
import { formatDate, formatRelative } from "@/lib/dates";
import { formatPhone, isPlaceholderPhone } from "@/lib/phone";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { tenantStatusMessage } from "@/policy/tenant-status";
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
import { ASSIGNABLE_TENANT_ROLES, TENANT_ROLE_META, normalizePlatformRole, type AssignableTenantRole } from "@/lib/roles";
import { useOpsAccess } from "@/components/ops-access";
import { RoleRequestsSection } from "./role-requests-section";
import { OPS } from "@/lib/routes";

type Role = AssignableTenantRole;

export function ClientPeople({
  tenant,
  members,
  invites,
  roleRequests,
}: {
  tenant: { id: string; name: string; status: string };
  members: MemberRow[];
  invites: InviteRow[];
  roleRequests: RoleRequestRow[];
}) {
  const { run, isPending, pending } = useAction();
  const { canMutate } = useOpsAccess();
  const confirm = useConfirm();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState<{ email: string; role: Role }>({ email: "", role: "member" });
  const [phoneFor, setPhoneFor] = useState<MemberRow | null>(null);
  const [phone, setPhone] = useState("");

  async function invite() {
    const res = await run(() => inviteMemberAction({ tenantId: tenant.id, ...inviteForm }), {
      key: "invite",
      success: `Invitation sent to ${inviteForm.email}`,
    });
    if (res?.ok) {
      setInviteOpen(false);
      setInviteForm({ email: "", role: "member" });
    }
  }

  async function savePhone() {
    if (!phoneFor) return;
    const res = await run(() => opsSetUserPhoneAction({ tenantId: tenant.id, userId: phoneFor.userId, phone }), {
      key: "phone",
      success: `${phoneFor.name}'s phone updated`,
    });
    if (res?.ok) setPhoneFor(null);
  }

  async function transfer(m: MemberRow) {
    const ok = await confirm({
      title: `Make ${m.name} the owner of ${tenant.name}?`,
      description: "The current owner becomes an admin. Only the new owner can transfer it back.",
      confirmLabel: "Transfer ownership",
    });
    if (ok) void run(() => transferOwnershipAction(tenant.id, m.userId), { key: `transfer:${m.userId}`, success: `${m.name} is now the owner` });
  }

  async function remove(m: MemberRow) {
    const ok = await confirm({
      title: `Remove ${m.name} from ${tenant.name}?`,
      description: "They lose access immediately; you can invite them again later.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) void run(() => removeMemberAction(tenant.id, m.memberId), { key: `remove:${m.memberId}`, success: `${m.name} removed` });
  }

  const statusNote = tenantStatusMessage(tenant.status);

  return (
    <div className="flex flex-col gap-8">
      <RoleRequestsSection
        tenantId={tenant.id}
        requests={roleRequests}
        canDecide={canMutate}
        readOnlyReason={canMutate ? null : "An ops admin can approve or decline this."}
      />
      <Section
        title="Members"
        icon={Users}
        count={members.length}
        description={statusNote || undefined}
        actions={
          canMutate ? (
            <Button size="sm" className="gap-1.5" onClick={() => setInviteOpen(true)}>
              <MailPlus className="size-4" /> Invite
            </Button>
          ) : undefined
        }
      >
        <DataTableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden md:table-cell">Phone</TableHead>
                <TableHead className="hidden sm:table-cell">Verified</TableHead>
                <TableHead className="hidden lg:table-cell">Last seen</TableHead>
                <TableHead className="hidden lg:table-cell">Joined</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 && <TableEmpty colSpan={7} icon={Users} title="No members" description="Invite the client's owner to get started." />}
              {members.map((m) => (
                <TableRow key={m.memberId}>
                  <TableCell>
                    <div className="flex items-center gap-1.5 font-medium text-heading">
                      <Link href={OPS.user(m.userId)} className="hover:text-primary">{m.name}</Link>
                      {normalizePlatformRole(m.platformRole) !== "customer" && (
                        <StatusBadge kind="platformRole" status={m.platformRole} className="text-[10px]" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <a href={`mailto:${m.email}`} className="hover:text-primary">{m.email}</a>
                    </div>
                  </TableCell>
                  <TableCell>
                    {m.role === "owner" || !canMutate ? (
                      <StatusBadge kind="tenantRole" status={m.role} />
                    ) : (
                      <Select
                        value={m.role}
                        disabled={isPending(`role:${m.memberId}`)}
                        onValueChange={(v) =>
                          void run(() => updateMemberRoleAction({ tenantId: tenant.id, memberId: m.memberId, role: v as Role }), {
                            key: `role:${m.memberId}`,
                            success: `${m.name} is now ${v}`,
                          })
                        }
                      >
                        <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ASSIGNABLE_TENANT_ROLES.map((r) => <SelectItem key={r} value={r}>{TENANT_ROLE_META[r].label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1 ${canMutate ? "hover:text-primary" : "cursor-default"} ${isPlaceholderPhone(m.phone) ? "text-warning" : "text-muted-foreground"}`}
                      title={canMutate ? "Edit phone" : undefined}
                      disabled={!canMutate}
                      onClick={() => {
                        setPhoneFor(m);
                        setPhone(isPlaceholderPhone(m.phone) ? "" : m.phone);
                      }}
                    >
                      <Phone className="size-3.5" />
                      {isPlaceholderPhone(m.phone) ? "not collected" : formatPhone(m.phone)}
                    </button>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <StatusBadge kind="verification" status={m.emailVerified ? "verified" : "pending"} />
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell" title={m.lastSeenAt ? formatDate(m.lastSeenAt) : undefined}>
                    {m.lastSeenAt ? formatRelative(m.lastSeenAt) : <span className="text-warning">never</span>}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{formatDate(m.joinedAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {canMutate && m.role !== "owner" && (
                        <Button variant="ghost" size="icon" title="Transfer ownership" disabled={pending} onClick={() => void transfer(m)}>
                          <Crown className="size-4" />
                        </Button>
                      )}
                      {canMutate && m.role !== "owner" && (
                        <Button variant="ghost" size="icon" title="Remove member" disabled={pending} onClick={() => void remove(m)}>
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableShell>
      </Section>

      <Section title="Pending invitations" icon={MailPlus} count={invites.length}>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open invitations.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {invites.map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2 text-sm">
                <span className="font-medium text-heading">{inv.email}</span>
                <StatusBadge kind="tenantRole" status={inv.role} />
                <span className="text-xs text-muted-foreground">
                  expires {formatDate(inv.expiresAt)}{inv.inviterName ? ` · invited by ${inv.inviterName}` : ""}
                </span>
                {canMutate && (
                  <div className="ml-auto flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending(`resend:${inv.id}`) || isPending(`cancel:${inv.id}`)}
                      onClick={() => void run(() => resendInviteAction(tenant.id, inv.id), { key: `resend:${inv.id}`, success: `Invitation re-sent to ${inv.email}` })}
                    >
                      Resend
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending(`resend:${inv.id}`) || isPending(`cancel:${inv.id}`)}
                      onClick={() => void run(() => cancelInviteAction(tenant.id, inv.id), { key: `cancel:${inv.id}`, success: "Invitation canceled" })}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite to {tenant.name}</DialogTitle>
            <DialogDescription>They get an email with a 7-day link; new people create an account on the way in.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="inv-email">Email</Label>
              <Input id="inv-email" type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Role</Label>
              <Select value={inviteForm.role} onValueChange={(v) => setInviteForm({ ...inviteForm, role: v as Role })}>
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
            <Button onClick={invite} disabled={isPending("invite") || !inviteForm.email}>
              {isPending("invite") ? "Sending…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!phoneFor} onOpenChange={(o) => !o && setPhoneFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Phone for {phoneFor?.name}</DialogTitle>
            <DialogDescription>Include the country code. Accounts created from a setup link start without one.</DialogDescription>
          </DialogHeader>
          <Input id="member-phone" autoFocus placeholder="+1 555 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <DialogFooter>
            <Button onClick={savePhone} disabled={isPending("phone") || !phone.trim()}>
              {isPending("phone") ? "Saving…" : "Save phone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
