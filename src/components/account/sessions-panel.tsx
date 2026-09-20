"use client";

import { LogOut } from "lucide-react";
import type { SessionRow } from "@/modules/account/queries";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/modules/account/actions";
import { formatDate, formatRelative } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";

/** Where you're signed in, with per-device and everywhere-else sign-out. */
export function SessionsPanel({ sessions }: { sessions: SessionRow[] }) {
  const { run, isPending } = useAction();
  const confirm = useConfirm();
  const others = sessions.filter((s) => !s.current).length;

  async function signOutDevice(s: SessionRow) {
    const ok = await confirm({ title: `Sign out ${s.device}?`, description: "That device is signed out on its next request.", confirmLabel: "Sign out", destructive: true });
    if (!ok) return;
    void run(() => revokeSessionAction(s.id), { key: `sess:${s.id}`, success: `${s.device} signed out` });
  }

  async function signOutOthers() {
    const ok = await confirm({
      title: "Sign out all other devices?",
      description: `${others} other session${others === 1 ? "" : "s"} end on their next request. This device stays signed in.`,
      confirmLabel: "Sign out others",
      destructive: true,
    });
    if (!ok) return;
    void run(() => revokeOtherSessionsAction(), {
      key: "sess:others",
      success: (r) => `Signed out ${r.revoked} other device${r.revoked === 1 ? "" : "s"}`,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y rounded-lg border bg-card">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
            <span className="font-medium text-heading">{s.device}</span>
            {s.current && <StatusBadge kind="session" status="current" className="text-[10px]" />}
            <span className="text-xs text-muted-foreground">
              {s.ipAddress ? `${s.ipAddress} · ` : ""}signed in {formatDate(s.createdAt)} · last active {formatRelative(s.lastActiveAt)}
            </span>
            {!s.current && (
              <Button variant="ghost" size="sm" className="ml-auto" disabled={isPending(`sess:${s.id}`)} onClick={() => void signOutDevice(s)}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" className="gap-2" disabled={others === 0 || isPending("sess:others")} onClick={() => void signOutOthers()}>
          <LogOut className="size-4" /> Sign out all other devices
        </Button>
      </div>
    </div>
  );
}
