import { requireWorkPage } from "@/policy";
import { WorkFrame } from "@/components/work-frame";
import { WorkTransitionHost } from "@/modules/work/components/transition-host";

export const dynamic = "force-dynamic";

/**
 * Work shell: the guard for hard loads (pages re-check on soft navigation),
 * one content width, and the transition screens (Resolve, Add flag) shared
 * by the board, the list and the issue view.
 */
export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  await requireWorkPage();
  return (
    <WorkTransitionHost>
      <WorkFrame>{children}</WorkFrame>
    </WorkTransitionHost>
  );
}
