"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { OPS } from "@/lib/routes";
import { isNavActive } from "@/components/ops-nav";

/** Routes that need the full viewport (two-pane layouts). */
const WIDE_OPS_ROUTES = [OPS.inbox];

/** The one content width for ops pages — pages render no wrapper of their own. */
export function OpsFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wide = WIDE_OPS_ROUTES.some((w) => isNavActive(w, pathname));
  return (
    <div className={cn("mx-auto flex w-full flex-col gap-6", wide ? "max-w-none" : "max-w-6xl")}>
      {children}
    </div>
  );
}
