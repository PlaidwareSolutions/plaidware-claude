import { requireOpsPage } from "@/policy";
import { OpsFrame } from "@/components/ops-frame";

export const dynamic = "force-dynamic";

/** Ops shell: the guard for hard loads (pages re-check on soft navigation) + one content width. */
export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  await requireOpsPage();
  return <OpsFrame>{children}</OpsFrame>;
}
