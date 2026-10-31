"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type LinkTab = {
  href: string;
  label: string;
  count?: number;
  /** The group's index tab: active only on an exact match. */
  exact?: boolean;
  icon?: LucideIcon;
  /** Also require these search params (undefined = absent): two tabs on one path, e.g. ?view=list. */
  query?: Record<string, string | undefined>;
};

export function isTabActive(href: string, pathname: string, exact?: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

/** Route-driven tabs (nested segments), the one tab mechanism in the app. */
export function LinkTabs({ items, className, tone = "default" }: { items: LinkTab[]; className?: string; tone?: "default" | "info" }) {
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <nav aria-label="Sections" className={cn("flex w-full gap-1 overflow-x-auto overflow-y-hidden border-b", className)}>
      {items.map((t) => {
        const active =
          isTabActive(t.href.split("?")[0], pathname, t.exact) &&
          Object.entries(t.query ?? {}).every(([k, v]) => (params.get(k) ?? undefined) === v);
        return (
          <Link
            key={t.href}
            href={t.href}
            data-active={active}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative -mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
              active && (tone === "info" ? "border-info text-info hover:text-info" : "border-foreground text-foreground"),
            )}
          >
            {t.icon && <t.icon className="size-4" />}
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
