"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Plus, Trash2, UserCog } from "lucide-react";
import type { UserMembershipRow, UserRoleRequestRow } from "@/modules/tenancy/queries";
import { opsAddMemberAction, removeMemberAction } from "@/modules/tenancy/actions";
import { membershipEffect } from "@/modules/tenancy/membership-rules";
import type { PlatformUserDetail } from "../queries";
import { OPS } from "@/lib/routes";
import { formatDate, formatRelative } from "@/lib/dates";
import { ASSIGNABLE_TENANT_ROLES, TENANT_ROLE_META, normalizePlatformRole, type AssignableTenantRole } from "@/lib/roles";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { useOpsAccess } from "@/components/ops-access";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** A workspace an ops admin may add this account to. */
export type WorkspaceOption = { id: string; name: string; slug: string; status: string };

const DEVELOPER_NOTE =
  "A developer's memberships are context only: each one unlocks that client's brief under Work → Clients and names the client on its items. Developers never reach the workspace itself.";

/** The Workspaces tab of an account: memberships (ops admins add and remove them here) and open role requests. */
export function UserWorkspaces({
  user,
  memberships,
  requests,
  workspaces,
}: {
  user: PlatformUserDetail;
  memberships: UserMembershipRow[];
  requests: UserRoleRequestRow[];
  /** Every workspace, for the Add dialog (empty unless the viewer may mutate). */
  workspaces: WorkspaceOption[];
}) {
  const { run, isPending } = useAction();
  const confirm = useConfirm();
  const { canMutate } = useOpsAccess();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ tenantId: string; role: AssignableTenantRole }>({ tenantId: "", role: "member" });
  const platformRole = normalizePlatformRole(user.platformRole);
  const dev = platformRole === "developer";
  const disabled = !!user.disabledAt;
  const joined = new Set(memberships.map((m) => m.id));
  const options = workspaces.filter((w) => !joined.has(w.id));
  const canAdd = canMutate && !disabled && options.length > 0;

  async function add() {
    const ws = options.find((w) => w.id === form.tenantId);
    if (!ws) return;
    const res = await run(() => opsAddMemberAction({ tenantId: ws.id, userId: user.id, role: form.role }), {
      key: "add",
      success: `${user.name} added to ${ws.name} as ${TENANT_ROLE_META[form.role].label}`,
    });
    if (res?.ok) {
      setOpen(false);
      setForm({ tenantId: "", role: "member" });
    }
  }

  async function remove(m: UserMembershipRow) {
    const ok = await confirm({
      title: `Remove ${user.name} from ${m.name}?`,
      description: dev
        ? "The client leaves their Work → Clients list and its items stop naming the client for them."
        : "They lose access immediately; you can add or invite them again later.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) {
      void run(() => removeMemberAction(m.id, m.memberId), { key: `remove:${m.memberId}`, success: `${user.name} removed from ${m.name}` });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Workspaces"
        icon={Building2}
        count={memberships.length}
        description={dev ? DEVELOPER_NOTE : undefined}
        actions={
          canAdd ? (
            <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Add to workspace
            </Button>
          ) : undefined
        }
      >
        <DataTableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Joined</TableHead>
                {canMutate && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {memberships.length === 0 && (
                <TableEmpty
                  colSpan={canMutate ? 5 : 4}
                  icon={Building2}
                  title="No workspace memberships"
                  description={
                    dev
                      ? "Add one to give this developer a client's context in the work area."
                      : "Access comes from workspace memberships; this account has none."
                  }
                />
              )}
              {memberships.map((m) => (
                <TableRow key={m.memberId}>
                  <TableCell>
                    <Link href={OPS.client(m.id)} className="font-medium text-heading hover:text-primary">
                      {m.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{m.slug}</div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="tenant" status={m.status} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="tenantRole" status={m.role} />
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{formatDate(m.joinedAt)}</TableCell>
                  {canMutate && (
                    <TableCell className="text-right">
                      {m.role !== "owner" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove from ${m.name}`}
                          title={`Remove from ${m.name}`}
                          disabled={isPending(`remove:${m.memberId}`)}
                          onClick={() => void remove(m)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableShell>
      </Section>

      {requests.length > 0 && (
        <Section title="Open role requests" icon={UserCog} count={requests.length} description="Decided from the workspace's People tab.">
          <div className="flex flex-col gap-2">
            {requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2.5 text-sm">
                <Link href={OPS.clientTab(r.tenantId, "people")} className="font-medium text-heading hover:text-primary">
                  {r.tenantName}
                </Link>
                <span className="inline-flex items-center gap-1.5">
                  <StatusBadge kind="tenantRole" status={r.currentRole} />
                  <ArrowRight className="size-3 text-muted-foreground" />
                  <StatusBadge kind="tenantRole" status={r.requestedRole} />
                </span>
                {r.note && <span className="min-w-0 flex-1 truncate italic text-muted-foreground" title={r.note}>“{r.note}”</span>}
                <span className="ml-auto text-xs text-muted-foreground">requested {formatRelative(r.createdAt)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {user.name} to a workspace</DialogTitle>
            <DialogDescription>{membershipEffect(platformRole, form.role)}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Workspace</Label>
              <Select value={form.tenantId} onValueChange={(v) => setForm({ ...form, tenantId: v })}>
                <SelectTrigger aria-label="Workspace">
                  <SelectValue placeholder="Choose a client workspace" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                      {w.status !== "active" ? ` (${w.status})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as AssignableTenantRole })}>
                <SelectTrigger aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_TENANT_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {TENANT_ROLE_META[r].label} — {TENANT_ROLE_META[r].description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dev && <p className="text-[11px] text-muted-foreground">The role is how the client&apos;s People tab lists them; it grants a developer nothing.</p>}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={add} disabled={isPending("add") || !form.tenantId}>
              {isPending("add") ? "Adding…" : "Add to workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
