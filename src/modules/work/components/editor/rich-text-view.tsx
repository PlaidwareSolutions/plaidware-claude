"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * Stored rich text, shown. `html` is what queries.ts returns — already
 * sanitised server-side (renderRichText), so it's rendered as-is. Images show
 * as small thumbnails (Jira's media cards); clicking one opens a preview over
 * the page. Links open in a new tab (the sanitiser sets that).
 */
export function RichTextView({ html, className }: { html: string; className?: string }) {
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);
  return (
    <>
      <div
        className={cn("work-rich-text work-rich-view", className)}
        onClick={(e) => {
          const el = e.target as HTMLElement;
          if (el.tagName === "IMG") {
            e.stopPropagation();
            const img = el as HTMLImageElement;
            setPreview({ src: img.src, alt: img.alt || "Image" });
          }
          // Following a link must not also start editing the block around it.
          if (el.closest("a")) e.stopPropagation();
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="w-auto max-w-[min(92vw,1200px)] gap-3 p-3 sm:max-w-[min(92vw,1200px)]" onClick={(e) => e.stopPropagation()}>
          <DialogTitle className="sr-only">{preview?.alt ?? "Image"}</DialogTitle>
          <DialogDescription className="sr-only">Image preview</DialogDescription>
          {preview && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- user upload served by the attachment route */}
              <img src={preview.src} alt={preview.alt} className="max-h-[80vh] max-w-full rounded-md object-contain" />
              <div className="flex items-center justify-between gap-3 px-1 text-sm">
                <span className="truncate text-muted-foreground">{preview.alt}</span>
                <a href={preview.src} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 font-medium text-info hover:underline">
                  <ExternalLink className="size-4" /> Open original
                </a>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
