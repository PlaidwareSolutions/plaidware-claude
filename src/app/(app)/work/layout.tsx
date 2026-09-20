import { requireWorkPage } from "@/policy";
import { WorkFrame } from "@/components/work-frame";

export const dynamic = "force-dynamic";

/** Work shell: the guard for hard loads (pages re-check on soft navigation) + one content width. */
export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  await requireWorkPage();
  return <WorkFrame>{children}</WorkFrame>;
}
