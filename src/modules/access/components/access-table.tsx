"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, Users } from "lucide-react";
import type { PlatformUserRow } from "../queries";
import { setPlatformRoleAction } from "../actions";
import {
  GRANTABLE_PLATFORM_ROLES,
  canChangePlatformRole,
  platformRoleChangeConfirm,
  typedEmailMatches,
} from "../rules";
import { PLATFORM_ROLES, PLATFORM_ROLE_META, normalizePlatformRole, type PlatformRole } from "@/lib/roles";
import { OPS, withQuery } from "@/lib/routes";
import { formatDate, formatRelative } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { FilterChip } from "@/components/filter-chip";
import { StatusBadge } from "@/components/status-badge";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import { Input } from "@/components/ui/input";
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

export function AccessTable({
  users,
  selfUserId,
  opsAdminCount,
  filter,
}: {
  users: PlatformUserRow[];
  selfUserId: string;
  opsAdminCount: number;
  filter: { q?: string; role?: string };
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const { run, isPending } = useAction();
  const [q, setQ] = useState(filter.q ?? "");

  function push(next: { q?: string; role?: string }) {
    router.push(withQuery(OPS.access, { q: filter.q, role: filter.role, ...next }));
  }

  async function change(u: PlatformUserRow, next: PlatformRole) {
    const before = normalizePlatformRole(u.platformRole);
    const verdict = canChangePlatformRole({
      actorUserId: selfUserId,
      targetUserId: u.id,
      targetEmailVerified: u.emailVerified,
      current: before,
      next,
      opsAdminCount,
    });
    if (!verdict.ok) {
      toast.error(verdict.reason);
      return;
    }
    const c = platformRoleChangeConfirm({ before, after: next, name: u.name, email: u.email });
    const ok = await confirm({
      title: c.title,
      description: c.description,
      destructive: c.destructive,
      confirmLabel: c.destructive ? "Revoke" : "Grant",
      field: c.typedEmail
        ? { label: "Type the email address to confirm", placeholder: u.email, required: true }
        : undefined,
    });
    if (!ok) return;
    if (c.typedEmail && !typedEmailMatches(ok.value, u.email)) {
      toast.error("The email address didn't match.");
      return;
    }
    await run(() => setPlatformRoleAction({ userId: u.id, role: next }), {
      key: `role:${u.id}`,
      success: `${u.name} is now ${PLATFORM_ROLE_META[next].label}`,
    });
  }

  const filtered = !!(filter.q || filter.role);

  return (
    <DataTableShell
      toolbar={
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            push({ q: q.trim() || undefined });
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or email"
              className="w-60 pl-8"
              aria-label="Search accounts"
            />
          </div>
          <Select value={filter.role ?? "all"} onValueChange={(v) => push({ role: v === "all" ? undefined : v })}>
            <SelectTrigger size="sm" className="w-36" aria-label="Platform role"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {PLATFORM_ROLES.map((r) => (
                <SelectItem key={r} value={r}>{PLATFORM_ROLE_META[r].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtered && (
            <FilterChip
              label={[filter.q ? `“${filter.q}”` : null, filter.role ? PLATFORM_ROLE_META[normalizePlatformRole(filter.role)].label : null].filter(Boolean).join(" · ")}
              clearHref={OPS.access}
            />
          )}
        </form>
      }
      footer={`${users.length} account${users.length === 1 ? "" : "s"}${filtered ? " matching" : ""} — every sign-in on the platform, with workspace memberships. ${opsAdminCount} ops admin${opsAdminCount === 1 ? "" : "s"}.`}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Platform role</TableHead>
            <TableHead className="hidden sm:table-cell">Verified</TableHead>
            <TableHead className="hidden md:table-cell">Workspaces</TableHead>
            <TableHead className="hidden lg:table-cell">Last seen</TableHead>
            <TableHead className="hidden md:table-cell">Joined</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.length === 0 && (
            <TableEmpty colSpan={6} icon={Users} title={filtered ? "No accounts match" : "No accounts yet"} />
          )}
          {users.map((u) => {
            const role = normalizePlatformRole(u.platformRole);
            const self = u.id === selfUserId;
            return (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium text-heading">
                    {u.name}
                    {self && <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell>
                  {self ? (
                    <span title="Ask another ops admin to change your role">
                      <StatusBadge kind="platformRole" status={role} />
                    </span>
                  ) : (
                    <Select
                      value={role}
                      disabled={isPending(`role:${u.id}`)}
                      onValueChange={(v) => void change(u, v as PlatformRole)}
                    >
                      <SelectTrigger size="sm" className="w-32" aria-label={`Platform role for ${u.name}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {GRANTABLE_PLATFORM_ROLES.map((r) => {
                          const verdict =
                            r === role
                              ? { ok: true as const }
                              : canChangePlatformRole({
                                  actorUserId: selfUserId,
                                  targetUserId: u.id,
                                  targetEmailVerified: u.emailVerified,
                                  current: role,
                                  next: r,
                                  opsAdminCount,
                                });
                          return (
                            <SelectItem key={r} value={r} disabled={!verdict.ok} title={verdict.ok ? undefined : verdict.reason}>
                              {PLATFORM_ROLE_META[r].label}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <StatusBadge kind="verification" status={u.emailVerified ? "verified" : "pending"} />
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {u.tenants.length === 0
                    ? "—"
                    : u.tenants.map((t, i) => (
                        <span key={t.id}>
                          {i > 0 && ", "}
                          <Link href={OPS.client(t.id)} className="hover:text-primary">{t.name}</Link>
                        </span>
                      ))}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground lg:table-cell" title={u.lastSeenAt ? formatDate(u.lastSeenAt) : undefined}>
                  {u.lastSeenAt ? formatRelative(u.lastSeenAt) : <span className="text-warning">never</span>}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {formatDate(u.createdAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DataTableShell>
  );
}
