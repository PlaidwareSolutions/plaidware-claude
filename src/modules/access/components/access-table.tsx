"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Search, Users } from "lucide-react";
import type { PlatformUserRow } from "../queries";
import { sendPasswordSetupAction } from "../actions";
import { AddStaffDialog } from "./add-staff-dialog";
import { PlatformRoleSelect } from "./platform-role-select";
import { PLATFORM_ROLES, PLATFORM_ROLE_META, normalizePlatformRole } from "@/lib/roles";
import { accountStatusOf } from "@/lib/account-status";
import { OPS, withQuery } from "@/lib/routes";
import { formatDate, formatRelative } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { useOpsAccess } from "@/components/ops-access";
import { FilterChip } from "@/components/filter-chip";
import { StatusBadge } from "@/components/status-badge";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
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

export type AccessFilter = { q?: string; role?: string; status?: string };

export function AccessTable({
  users,
  hasMore,
  selfUserId,
  opsAdminCount,
  filter,
}: {
  users: PlatformUserRow[];
  /** More rows exist beyond the query limit — the footer asks for a narrower search. */
  hasMore: boolean;
  selfUserId: string;
  opsAdminCount: number;
  filter: AccessFilter;
}) {
  const router = useRouter();
  const { run, isPending } = useAction();
  const { canMutate } = useOpsAccess();
  const [q, setQ] = useState(filter.q ?? "");

  function push(next: AccessFilter) {
    router.push(withQuery(OPS.access, { q: filter.q, role: filter.role, status: filter.status, ...next }));
  }

  const filtered = !!(filter.q || filter.role || filter.status);
  const chip = [
    filter.q ? `“${filter.q}”` : null,
    filter.role ? PLATFORM_ROLE_META[normalizePlatformRole(filter.role)].label : null,
    filter.status ? filter.status : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <DataTableShell
      toolbar={
        <div className="flex flex-wrap items-center justify-between gap-2">
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
              <SelectTrigger size="sm" className="w-36" aria-label="Platform role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {PLATFORM_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {PLATFORM_ROLE_META[r].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filter.status ?? "all"} onValueChange={(v) => push({ status: v === "all" ? undefined : v })}>
              <SelectTrigger size="sm" className="w-32" aria-label="Account status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="active">active</SelectItem>
                <SelectItem value="disabled">disabled</SelectItem>
              </SelectContent>
            </Select>
            {filtered && <FilterChip label={chip} clearHref={OPS.access} />}
          </form>
          {canMutate && <AddStaffDialog />}
        </div>
      }
      footer={`${hasMore ? `Showing the first ${users.length} accounts — refine your search. ` : `${users.length} account${users.length === 1 ? "" : "s"}${filtered ? " matching" : ""} — `}every sign-in on the platform, with workspace memberships. ${opsAdminCount} ops admin${opsAdminCount === 1 ? "" : "s"}.`}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Platform role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden sm:table-cell">Verified</TableHead>
            <TableHead className="hidden md:table-cell">Workspaces</TableHead>
            <TableHead className="hidden lg:table-cell">Last seen</TableHead>
            <TableHead className="hidden md:table-cell">Joined</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.length === 0 && (
            <TableEmpty colSpan={7} icon={Users} title={filtered ? "No accounts match" : "No accounts yet"} />
          )}
          {users.map((u) => {
            const self = u.id === selfUserId;
            const disabled = !!u.disabledAt;
            return (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium text-heading">
                    <Link href={OPS.user(u.id)} className="hover:text-primary">
                      {u.name}
                    </Link>
                    {self && <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <PlatformRoleSelect user={u} selfUserId={selfUserId} opsAdminCount={opsAdminCount} />
                    {canMutate && !self && !disabled && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Send set-password link"
                        aria-label={`Send set-password link to ${u.name}`}
                        disabled={isPending(`setup:${u.id}`)}
                        onClick={() =>
                          void run(() => sendPasswordSetupAction(u.id), {
                            key: `setup:${u.id}`,
                            success: `Set-password link sent to ${u.email}`,
                            refresh: false,
                          })
                        }
                      >
                        <Mail className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge kind="accountStatus" status={accountStatusOf(u.disabledAt)} />
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
                          <Link href={OPS.client(t.id)} className="hover:text-primary">
                            {t.name}
                          </Link>
                        </span>
                      ))}
                </TableCell>
                <TableCell
                  className="hidden text-sm text-muted-foreground lg:table-cell"
                  title={u.lastSeenAt ? formatDate(u.lastSeenAt) : undefined}
                >
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
