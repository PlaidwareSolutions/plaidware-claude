import { opsLevel, requireOpsPage } from "@/policy";
import { OpsAccessProvider } from "@/components/ops-access";
import { OpsFrame } from "@/components/ops-frame";

export const dynamic = "force-dynamic";

/**
 * Ops shell: the guard for hard loads (pages re-check on soft navigation),
 * the ops level for client components, and one content width.
 */
export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOpsPage("support");
  return (
    <OpsAccessProvider level={opsLevel(session) ?? "support"}>
      <OpsFrame>{children}</OpsFrame>
    </OpsAccessProvider>
  );
}
