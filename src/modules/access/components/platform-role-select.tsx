"use client";

import { toast } from "sonner";
import { setPlatformRoleAction } from "../actions";
import {
  GRANTABLE_PLATFORM_ROLES,
  canChangePlatformRole,
  platformRoleChangeConfirm,
  typedEmailMatches,
} from "../rules";
import { PLATFORM_ROLE_META, normalizePlatformRole, type PlatformRole } from "@/lib/roles";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { useOpsAccess } from "@/components/ops-access";
import { StatusBadge } from "@/components/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type PlatformRoleTarget = {
  id: string;
  name: string;
  email: string;
  platformRole: string;
  emailVerified: boolean;
};

/**
 * The one control that changes a platform role: rules pre-validate each
 * option, the change is confirmed (typed email when ops admin is involved)
 * and setPlatformRoleAction enforces the same rules server-side. Renders a
 * badge for the viewer's own row and for ops support.
 */
export function PlatformRoleSelect({
  user,
  selfUserId,
  opsAdminCount,
  className,
}: {
  user: PlatformRoleTarget;
  selfUserId: string;
  opsAdminCount: number;
  className?: string;
}) {
  const confirm = useConfirm();
  const { run, isPending } = useAction();
  const { canMutate } = useOpsAccess();
  const role = normalizePlatformRole(user.platformRole);
  const self = user.id === selfUserId;

  if (self || !canMutate) {
    return (
      <span title={self ? "Ask another ops admin to change your role" : undefined}>
        <StatusBadge kind="platformRole" status={role} />
      </span>
    );
  }

  async function change(next: PlatformRole) {
    const verdict = canChangePlatformRole({
      actorUserId: selfUserId,
      targetUserId: user.id,
      targetEmailVerified: user.emailVerified,
      current: role,
      next,
      opsAdminCount,
    });
    if (!verdict.ok) {
      toast.error(verdict.reason);
      return;
    }
    const c = platformRoleChangeConfirm({ before: role, after: next, name: user.name, email: user.email });
    const ok = await confirm({
      title: c.title,
      description: c.description,
      destructive: c.destructive,
      confirmLabel: c.destructive ? "Revoke" : "Grant",
      field: c.typedEmail
        ? { label: "Type the email address to confirm", placeholder: user.email, required: true }
        : undefined,
    });
    if (!ok) return;
    if (c.typedEmail && !typedEmailMatches(ok.value, user.email)) {
      toast.error("The email address didn't match.");
      return;
    }
    await run(() => setPlatformRoleAction({ userId: user.id, role: next }), {
      key: `role:${user.id}`,
      success: `${user.name} is now ${PLATFORM_ROLE_META[next].label}`,
    });
  }

  return (
    <Select value={role} disabled={isPending(`role:${user.id}`)} onValueChange={(v) => void change(v as PlatformRole)}>
      <SelectTrigger size="sm" className={className ?? "w-32"} aria-label={`Platform role for ${user.name}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {GRANTABLE_PLATFORM_ROLES.map((r) => {
          const verdict =
            r === role
              ? { ok: true as const }
              : canChangePlatformRole({
                  actorUserId: selfUserId,
                  targetUserId: user.id,
                  targetEmailVerified: user.emailVerified,
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
  );
}
