"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, LayoutGrid } from "lucide-react";
import { withQuery } from "@/lib/routes";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WorkExplorerProduct } from "../../dto";

function Tile({ product, className }: { product: WorkExplorerProduct | null; className?: string }) {
  return (
    <span
      className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-bold text-white", !product && "bg-info", className)}
      style={product ? { background: product.color ?? "var(--primary)" } : undefined}
      aria-hidden
    >
      {product ? product.name[0]?.toUpperCase() : <LayoutGrid className="size-3" />}
    </span>
  );
}

/**
 * The board's scope — which companies it shows — as Jira keeps it: in the
 * breadcrumb, apart from the filters ("Projects / All projects ▾"). Writes
 * ?product=… and keeps every other parameter.
 */
export function ProjectScopePicker({ products, selected }: { products: WorkExplorerProduct[]; selected: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const chosen = products.filter((p) => selected.includes(p.slug));
  const set = (slugs: string[]) =>
    start(() => {
      const q = Object.fromEntries(params.entries());
      delete q.item;
      if (slugs.length) q.product = slugs.join(",");
      else delete q.product;
      router.replace(withQuery(pathname, q), { scroll: false });
    });
  const toggle = (slug: string) => set(selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug]);
  const label = chosen.length === 0 ? "All spaces" : chosen.length === 1 ? chosen[0].name : `${chosen.length} spaces`;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground" data-pending={pending ? "" : undefined}>
      <span>Spaces</span>
      <span aria-hidden>/</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-[3px] px-1.5 py-0.5 font-medium text-foreground hover:bg-accent" aria-label={`Board scope: ${label}`}>
            {chosen.length === 1 ? (
              <Tile product={chosen[0]} />
            ) : chosen.length > 1 ? (
              <span className="flex -space-x-1">
                {chosen.slice(0, 3).map((p) => (
                  <Tile key={p.slug} product={p} className="ring-2 ring-background" />
                ))}
              </span>
            ) : (
              <Tile product={null} />
            )}
            {label}
            <ChevronDown className="size-4 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onSelect={() => set([])} className="gap-2">
            <Tile product={null} /> <span className="flex-1">All spaces</span>
            {chosen.length === 0 && <Check className="size-4 text-info" />}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Show spaces</DropdownMenuLabel>
          <div className="max-h-80 overflow-y-auto">
            {products.map((p) => (
              <DropdownMenuCheckboxItem key={p.slug} checked={selected.includes(p.slug)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggle(p.slug)} className="gap-2">
                <Tile product={p} /> <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">{p.keyPrefix}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
