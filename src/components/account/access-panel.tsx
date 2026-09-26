import Link from "next/link";
import type { TenantSummary } from "@/modules/tenancy/queries";
import { PLATFORM_ROLE_META, TENANT_ROLE_META, isTenantRole, normalizePlatformRole } from "@/lib/roles";
import { tenantRoleMatrix } from "@/lib/role-matrices";
import { TENANT, WORK } from "@/lib/routes";
import { RoleMatrix } from "@/components/role-matrix";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";

/** What this account can do: its platform role and every workspace membership. */
export function AccessPanel({
  platformRole,
  isDeveloper,
  tenants,
  activeTenantId,
}: {
  platformRole: string | null | undefined;
  isDeveloper: boolean;
  tenants: TenantSummary[];
  activeTenantId: string | null;
}) {
  const role = normalizePlatformRole(platformRole);
  const active = tenants.find((t) => t.id === activeTenantId) ?? null;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="platformRole" status={role} />
        <span className="text-muted-foreground">{PLATFORM_ROLE_META[role].description}.</span>
      </div>
      {isDeveloper ? (
        tenants.length === 0 ? (
          <EmptyState
            compact
            title="No client workspaces"
            description="The work area is your whole Hub. When an ops admin adds you to a client's workspace, it appears here and under Work → Clients."
          />
        ) : (
          <>
            <p className="text-muted-foreground">
              The work area is your whole Hub; these client workspaces give you their context under Work → Clients.
            </p>
            <ul className="divide-y rounded-lg border bg-card">
              {tenants.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <Link href={WORK.client(t.id)} className="font-medium text-heading hover:text-primary">
                    {t.name}
                  </Link>
                  <StatusBadge kind="tenant" status={t.status} className="text-[10px]" />
                  <Link href={WORK.client(t.id)} className="ml-auto text-xs text-primary hover:underline">
                    Open brief
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )
      ) : tenants.length === 0 ? (
        <EmptyState compact title="No workspace memberships yet" description="A workspace appears when you subscribe to a product or accept an invitation." />
      ) : (
        <>
          <ul className="divide-y rounded-lg border bg-card">
            {tenants.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="font-medium text-heading">{t.name}</span>
                <StatusBadge kind="tenantRole" status={t.role} />
                <StatusBadge kind="tenant" status={t.status} className="text-[10px]" />
                <span className="text-xs text-muted-foreground">
                  {isTenantRole(t.role) ? TENANT_ROLE_META[t.role].description : ""}
                </span>
                {t.id === activeTenantId ? (
                  <Link href={TENANT.team} className="ml-auto text-xs text-primary hover:underline">
                    Team
                  </Link>
                ) : (
                  <span className="ml-auto text-xs text-muted-foreground">switch to this workspace to manage its team</span>
                )}
              </li>
            ))}
          </ul>
          <details className="rounded-lg border bg-card px-4 py-3">
            <summary className="cursor-pointer font-medium text-heading">What each role can do</summary>
            <div className="mt-3">
              <RoleMatrix data={tenantRoleMatrix()} highlightRow={active?.role ?? null} />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
