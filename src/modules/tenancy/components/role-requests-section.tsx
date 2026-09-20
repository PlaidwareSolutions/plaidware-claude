"use client";

import { ArrowRight, UserCog } from "lucide-react";
import type { RoleRequestRow } from "../queries";
import { approveRoleRequestAction, cancelRoleRequestAction, denyRoleRequestAction } from "../actions";
import { isRoleRequestStale, roleLabel } from "../role-request-rules";
import { TENANT_ROLE_META, isTenantRole } from "@/lib/roles";
import { formatRelative } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";

/**
 * Open role requests for a workspace, with Approve / Deny for deciders.
 * Shared by the tenant Team page and the ops People tab.
 */
export function RoleRequestsSection({
  tenantId,
  requests,
  canDecide,
  readOnlyReason = null,
}: {
  tenantId: string;
  requests: RoleRequestRow[];
  canDecide: boolean;
  /** Why this viewer can't decide right now (status, or ops level). */
  readOnlyReason?: string | null;
}) {
  const { run, isPending } = useAction();
  const confirm = useConfirm();

  async function approve(r: RoleRequestRow) {
    const meta = isTenantRole(r.requestedRole) ? TENANT_ROLE_META[r.requestedRole] : null;
    const ok = await confirm({
      title: `Make ${r.requesterName} ${roleLabel(r.requestedRole)}?`,
      description: meta ? `${meta.description}.` : undefined,
      confirmLabel: "Approve",
    });
    if (!ok) return;
    void run(() => approveRoleRequestAction({ tenantId, requestId: r.id }), {
      key: `approve:${r.id}`,
      success: `${r.requesterName} is now ${roleLabel(r.requestedRole)}`,
    });
  }

  async function deny(r: RoleRequestRow) {
    const ok = await confirm({
      title: `Decline ${r.requesterName}'s request?`,
      description: "They'll be told, and can ask again later.",
      confirmLabel: "Decline",
      destructive: true,
      field: { label: "Reason (optional)", placeholder: "Shared with the requester" },
    });
    if (!ok) return;
    void run(() => denyRoleRequestAction({ tenantId, requestId: r.id, note: ok.value?.trim() || undefined }), {
      key: `deny:${r.id}`,
      success: "Request declined",
    });
  }

  async function dismiss(r: RoleRequestRow) {
    void run(() => cancelRoleRequestAction({ tenantId, requestId: r.id }), {
      key: `dismiss:${r.id}`,
      success: "Request dismissed",
    });
  }

  if (requests.length === 0) return null;

  return (
    <Section
      title="Role requests"
      icon={UserCog}
      count={requests.length}
      description={!canDecide && readOnlyReason ? readOnlyReason : undefined}
    >
      <div className="flex flex-col gap-2">
        {requests.map((r) => {
          const stale = isRoleRequestStale({ currentRole: r.currentRole, liveRole: r.liveRole });
          const busy = isPending(`approve:${r.id}`) || isPending(`deny:${r.id}`) || isPending(`dismiss:${r.id}`);
          return (
            <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-heading">{r.requesterName}</div>
                <div className="text-xs text-muted-foreground">{r.requesterEmail}</div>
              </div>
              <span className="inline-flex items-center gap-1.5">
                <StatusBadge kind="tenantRole" status={r.currentRole} />
                <ArrowRight className="size-3 text-muted-foreground" />
                <StatusBadge kind="tenantRole" status={r.requestedRole} />
              </span>
              {r.note && <span className="min-w-0 flex-1 truncate italic text-muted-foreground" title={r.note}>“{r.note}”</span>}
              <span className="text-xs text-muted-foreground">requested {formatRelative(r.createdAt)}</span>
              {stale && (
                <span className="text-xs text-warning">role since changed to {roleLabel(r.liveRole)}</span>
              )}
              {canDecide && (
                <div className="ml-auto flex gap-1">
                  {stale ? (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void dismiss(r)}>Dismiss</Button>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void deny(r)}>Decline</Button>
                      <Button size="sm" disabled={busy} onClick={() => void approve(r)}>Approve</Button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
