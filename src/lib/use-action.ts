"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type ActionResult = { ok: true } | { ok: false; error?: string };

/**
 * The one way client code runs a server action: pending key, toast on the
 * result, router.refresh() on success. Returns the result (or null when it
 * threw) so callers can branch on extra fields.
 */
export function useAction() {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const run = useCallback(
    async <R extends ActionResult>(
      fn: () => Promise<R>,
      opts: {
        key?: string;
        success?: string | ((r: Extract<R, { ok: true }>) => string);
        error?: string;
        refresh?: boolean;
      } = {},
    ): Promise<R | null> => {
      setPendingKey(opts.key ?? "action");
      try {
        const res = await fn();
        if (res.ok) {
          const msg = typeof opts.success === "function" ? opts.success(res as Extract<R, { ok: true }>) : opts.success;
          if (msg) toast.success(msg);
          if (opts.refresh !== false) router.refresh();
        } else {
          toast.error(("error" in res && res.error) || opts.error || "Something went wrong");
        }
        return res;
      } catch (e) {
        toast.error(opts.error ?? (e instanceof Error ? e.message : "Something went wrong"));
        return null;
      } finally {
        setPendingKey(null);
      }
    },
    [router],
  );

  return {
    run,
    pending: pendingKey !== null,
    pendingKey,
    isPending: (key: string) => pendingKey === key,
  };
}
