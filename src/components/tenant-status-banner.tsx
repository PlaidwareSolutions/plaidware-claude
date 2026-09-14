import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { TENANT } from "@/lib/routes";
import { normalizeTenantStatus, tenantStatusMessage } from "@/policy/tenant-status";

/** Shown above every client page while the workspace is suspended or inactive. */
export function TenantStatusBanner({ status, showBillingLink = true }: { status: string | null | undefined; showBillingLink?: boolean }) {
  const s = normalizeTenantStatus(status);
  if (s === "active") return null;
  return (
    <div
      role="status"
      className={`mb-4 flex flex-wrap items-center gap-2 rounded-lg border px-4 py-2.5 text-sm ${s === "suspended" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-warning/40 bg-warning/10 text-warning"}`}
    >
      <AlertTriangle className="size-4 shrink-0" />
      <span className="flex-1">{tenantStatusMessage(s)}</span>
      {s === "suspended" && showBillingLink && (
        <Link href={TENANT.billing} className="font-medium underline-offset-2 hover:underline">
          Open billing
        </Link>
      )}
    </div>
  );
}
