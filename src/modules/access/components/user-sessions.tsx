"use client";

import { Activity } from "lucide-react";
import type { UserSessionRow } from "../queries";
import { revokeSessionAction } from "../actions";
import { describeUserAgent } from "@/lib/user-agent";
import { formatDate, formatDateTime, formatRelative } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { useOpsAccess } from "@/components/ops-access";
import { StatusBadge } from "@/components/status-badge";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** The Sessions tab of an account: every device, with per-row revoke for ops admins. */
export function UserSessions({
  userId,
  userName,
  sessions,
  viewerSessionId,
}: {
  userId: string;
  userName: string;
  sessions: UserSessionRow[];
  viewerSessionId: string;
}) {
  const { run, isPending } = useAction();
  const confirm = useConfirm();
  const { canMutate } = useOpsAccess();
  const active = sessions.filter((s) => !s.expired).length;

  async function revoke(s: UserSessionRow) {
    const ok = await confirm({
      title: `Sign ${userName} out of ${describeUserAgent(s.userAgent).label}?`,
      description: "That device is signed out on its next request.",
      confirmLabel: "Revoke session",
      destructive: true,
    });
    if (!ok) return;
    void run(() => revokeSessionAction({ userId, sessionId: s.id }), { key: `revoke:${s.id}`, success: "Session revoked" });
  }

  return (
    <DataTableShell footer={`${active} active session${active === 1 ? "" : "s"}${sessions.length > active ? ` · ${sessions.length - active} expired` : ""}.`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Device</TableHead>
            <TableHead className="hidden sm:table-cell">IP</TableHead>
            <TableHead className="hidden md:table-cell">Active workspace</TableHead>
            <TableHead className="hidden lg:table-cell">Signed in</TableHead>
            <TableHead>Last active</TableHead>
            <TableHead className="hidden md:table-cell">Expires</TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.length === 0 && <TableEmpty colSpan={7} icon={Activity} title="No sessions" description="This account has never signed in." />}
          {sessions.map((s) => {
            const current = s.id === viewerSessionId;
            return (
              <TableRow key={s.id} className={s.expired ? "opacity-60" : undefined}>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium text-heading" title={s.userAgent ?? undefined}>
                    {describeUserAgent(s.userAgent).label}
                    {current && <StatusBadge kind="session" status="current" className="text-[10px]" />}
                  </div>
                </TableCell>
                <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{s.ipAddress ?? "—"}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{s.activeTenant?.name ?? "—"}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{formatDateTime(s.createdAt)}</TableCell>
                <TableCell className="text-sm text-muted-foreground" title={formatDateTime(s.updatedAt)}>{formatRelative(s.updatedAt)}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {s.expired ? <span className="text-warning">expired</span> : formatDate(s.expiresAt)}
                </TableCell>
                <TableCell className="text-right">
                  {canMutate && !current && !s.expired && (
                    <Button variant="ghost" size="sm" disabled={isPending(`revoke:${s.id}`)} onClick={() => void revoke(s)}>
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DataTableShell>
  );
}
