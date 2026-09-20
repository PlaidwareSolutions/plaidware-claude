"use client";

import { useState } from "react";
import { Mail, MoreHorizontal, ShieldBan, ShieldCheck } from "lucide-react";
import type { PlatformUserDetail } from "../queries";
import { sendPasswordSetupAction, setAccountDisabledAction } from "../actions";
import { accountDisableConfirm } from "../rules";
import { OPS } from "@/lib/routes";
import { formatDate, formatRelative } from "@/lib/dates";
import { normalizePlatformRole } from "@/lib/roles";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { useOpsAccess } from "@/components/ops-access";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserTabs } from "./user-tabs";
import { DisableAccountDialog } from "./disable-account-dialog";

export function UserHeader({ user, selfUserId }: { user: PlatformUserDetail; selfUserId: string }) {
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const { canMutate } = useOpsAccess();
  const [disableOpen, setDisableOpen] = useState(false);
  const self = user.id === selfUserId;
  const disabled = !!user.disabledAt;
  const role = normalizePlatformRole(user.platformRole);

  async function enable() {
    const c = accountDisableConfirm({ name: user.name, email: user.email, role, disabled: false });
    const ok = await confirm({ title: c.title, description: c.description, confirmLabel: "Re-enable" });
    if (!ok) return;
    void run(() => setAccountDisabledAction({ userId: user.id, disabled: false }), {
      key: "enable",
      success: `${user.name}'s account is active again`,
    });
  }

  return (
    <>
      <PageHeader
        back={{ href: OPS.access, label: "Access" }}
        title={user.name}
        badge={
          <>
            <StatusBadge kind="platformRole" status={role} />
            {disabled && <StatusBadge kind="accountStatus" status="disabled" />}
          </>
        }
        meta={
          <>
            {user.email}
            {self && " (you)"} · joined {formatDate(user.createdAt)} ·{" "}
            {user.lastSeenAt ? `last seen ${formatRelative(user.lastSeenAt)}` : "never signed in"}
          </>
        }
        actions={
          canMutate && !self ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="size-8 p-0" aria-label="Account actions" disabled={pending}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Account</DropdownMenuLabel>
                {!disabled && (
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(() => sendPasswordSetupAction(user.id), {
                        key: "setup",
                        success: `Set-password link sent to ${user.email}`,
                        refresh: false,
                      })
                    }
                  >
                    <Mail className="size-4" /> Send set-password link
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {disabled ? (
                  <DropdownMenuItem onSelect={() => void enable()}>
                    <ShieldCheck className="size-4" /> Re-enable account
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem variant="destructive" onSelect={() => setDisableOpen(true)}>
                    <ShieldBan className="size-4" /> Disable account…
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      >
        <UserTabs id={user.id} counts={{ workspaces: user.membershipCount, sessions: user.activeSessionCount }} />
      </PageHeader>
      <DisableAccountDialog user={user} open={disableOpen} onOpenChange={setDisableOpen} />
    </>
  );
}
