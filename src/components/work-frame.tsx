"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isWorkBoardPath } from "@/components/work-nav";

/** The one content width for work pages; the kanban board gets the full viewport. */
export function WorkFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wide = isWorkBoardPath(pathname);
  return (
    <div className={cn("mx-auto flex w-full flex-col gap-6", wide ? "max-w-none" : "max-w-6xl")}>
      {children}
    </div>
  );
}
