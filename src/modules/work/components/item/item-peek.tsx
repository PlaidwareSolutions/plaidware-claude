"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Link2, X } from "lucide-react";
import { toast } from "sonner";
import { WORK } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { WorkBoardMode } from "../../contracts";
import type { WorkItemDetailDto, WorkProductRef, WorkUserRef } from "../../dto";
import { usePeekHref } from "../peek-link";
import { ItemDetail } from "./item-detail";

/**
 * Quick view: the item opens in a side panel over the board (?item=slug~n),
 * so the board keeps its filters and scroll. Every edit refreshes both.
 */
export function ItemPeek({
  item,
  product,
  mode,
  canManage,
  canLinkClient,
  tenants,
  viewer,
}: {
  item: WorkItemDetailDto | null;
  product: WorkProductRef | null;
  mode: WorkBoardMode;
  canManage: boolean;
  canLinkClient: boolean;
  tenants: { id: string; name: string }[];
  viewer: WorkUserRef | null;
}) {
  const router = useRouter();
  const peek = usePeekHref();
  const close = () => router.replace(peek.close(), { scroll: false });
  const open = !!item && !!product;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && close()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-4xl"
        // The sheet's own × sat under the sticky header; ours lives in the header row.
        showCloseButton={false}
        // Jira opens the issue without focusing a control; Esc and the × still work.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {item && product && (
          <>
            <SheetHeader className="sticky top-0 z-10 flex-row items-center gap-2 border-b bg-background/95 px-6 py-3 pr-4 backdrop-blur">
              <span className="size-2.5 rounded-full" style={{ background: product.color ?? "var(--primary)" }} />
              <SheetTitle className="text-sm font-medium">
                {product.name} <span className="text-muted-foreground">/ {item.key}</span>
              </SheetTitle>
              <SheetDescription className="sr-only">Quick view of {item.key}</SheetDescription>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    const url = new URL(WORK.item(product.slug, item.number), window.location.origin).toString();
                    void navigator.clipboard.writeText(url).then(() => toast.success(`Link to ${item.key} copied`), () => toast.error("Couldn't copy the link"));
                  }}
                >
                  <Link2 className="size-3.5" /> Copy link
                </Button>
                <Button asChild variant="ghost" size="xs">
                  <Link href={WORK.item(product.slug, item.number)}>
                    <ExternalLink className="size-3.5" /> Open
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={close}
                  aria-label="Close"
                  title="Close (Esc)"
                  className="ml-1 rounded-full border bg-muted text-foreground hover:bg-accent"
                >
                  <X className="size-4" strokeWidth={2.5} />
                </Button>
              </div>
            </SheetHeader>
            <div className="p-6">
              <ItemDetail
                key={item.id}
                slug={product.slug}
                mode={mode}
                item={item}
                canManage={canManage}
                canLinkClient={canLinkClient}
                tenants={tenants}
                viewer={viewer}
                onDeleted={close}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
