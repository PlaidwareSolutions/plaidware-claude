"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type LinkTab = {
  href: string;
  label: string;
  count?: number;
  /** The group's index tab: active only on an exact match. */
  exact?: boolean;
};

export function isTabActive(href: string, pathname: string, exact?: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

/** Route-driven tabs (nested segments), the one tab mechanism in the app. */
export function LinkTabs({ items, className }: { items: LinkTab[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className={cn("flex w-full gap-1 overflow-x-auto border-b", className)}>
      {items.map((t) => {
        const active = isTabActive(t.href, pathname, t.exact);
        return (
          <Link
            key={t.href}
            href={t.href}
            data-active={active}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative -mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
              active && "border-foreground text-foreground",
            )}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <Badge variant={active ? "default" : "secondary"} className="h-4 min-w-4 px-1 text-[10px]">
                {t.count}
              </Badge>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
