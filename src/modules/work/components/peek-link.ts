"use client";

import { useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { withQuery } from "@/lib/routes";
import { itemRef } from "../explorer-logic";

/** Hrefs that open (or close) the quick-view panel on the current page, keeping every other filter. */
export function usePeekHref() {
  const pathname = usePathname();
  const params = useSearchParams();
  const href = useCallback(
    (ref: string | null) => {
      const q = Object.fromEntries(params.entries());
      if (ref) q.item = ref;
      else delete q.item;
      return withQuery(pathname, q);
    },
    [pathname, params],
  );
  return {
    open: (slug: string, number: number) => href(itemRef(slug, number)),
    close: () => href(null),
  };
}
