import Link from "next/link";
import { X } from "lucide-react";

/** "Filtered to …" pill with a clear link — for boards deep-linked with ?tenant= / ?product=. */
export function FilterChip({ label, clearHref }: { label: string; clearHref: string }) {
  return (
    <Link
      href={clearHref}
      className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs text-heading hover:border-primary/50"
      title="Clear filter"
    >
      {label}
      <X className="size-3 text-muted-foreground" />
    </Link>
  );
}
