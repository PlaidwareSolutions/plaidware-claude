"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Globe, Loader2, SquareKanban } from "lucide-react";
import { previewLinkAction } from "../../actions";

type Preview = { url: string; title: string | null; description: string | null; siteName: string | null; image: string | null; internal?: boolean };

/** Previews already fetched this session (null = nothing to show). */
const seen = new Map<string, Preview | null>();

const host = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * Jira's smart-link hover card for links inside rich text: hover a link for a
 * moment to see the page's title, description and image (fetched server-side
 * with SSRF guards; links to our own tickets show the ticket). Attach with
 * useLinkHover(containerRef).
 */
export function useLinkHover(container: React.RefObject<HTMLElement | null>) {
  const [card, setCard] = useState<{ url: string; left: number; top: number; preview: Preview | null | undefined } | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef<string | null>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const clear = () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    const over = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!a || !/^https?:/i.test(a.href)) return;
      clear();
      if (current.current === a.href) return;
      showTimer.current = setTimeout(() => {
        const r = a.getBoundingClientRect();
        const left = Math.min(r.left, window.innerWidth - 336);
        const url = a.href;
        current.current = url;
        const known = seen.get(url);
        setCard({ url, left, top: r.bottom + 6, preview: seen.has(url) ? known : undefined });
        if (!seen.has(url)) {
          void previewLinkAction(url).then((res) => {
            const p = res.ok ? res.preview : null;
            seen.set(url, p);
            setCard((c) => (c && c.url === url ? { ...c, preview: p } : c));
          });
        }
      }, 450);
    };
    const out = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[href]");
      if (!a) return;
      if (showTimer.current) clearTimeout(showTimer.current);
      hideTimer.current = setTimeout(() => {
        current.current = null;
        setCard(null);
      }, 200);
    };
    el.addEventListener("mouseover", over);
    el.addEventListener("mouseout", out);
    return () => {
      clear();
      el.removeEventListener("mouseover", over);
      el.removeEventListener("mouseout", out);
    };
  }, [container]);

  const keep = () => hideTimer.current && clearTimeout(hideTimer.current);
  const leave = () => {
    hideTimer.current = setTimeout(() => {
      current.current = null;
      setCard(null);
    }, 150);
  };

  const node = card ? (
    <div
      role="dialog"
      aria-label={`Link preview: ${host(card.url)}`}
      className="fixed z-[90] w-80 overflow-hidden rounded-md border bg-popover text-sm shadow-lg"
      style={{ left: Math.max(8, card.left), top: card.top }}
      onMouseEnter={keep}
      onMouseLeave={leave}
    >
      {card.preview === undefined ? (
        <div className="flex items-center gap-2 px-3 py-3 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading preview…
        </div>
      ) : (
        <>
          {card.preview?.image && (
            // eslint-disable-next-line @next/next/no-img-element -- remote OpenGraph image, https only
            <img src={card.preview.image} alt="" className="h-36 w-full object-cover" referrerPolicy="no-referrer" />
          )}
          <div className="flex flex-col gap-1 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {card.preview?.internal ? <SquareKanban className="size-3.5" /> : <Globe className="size-3.5" />}
              <span className="truncate">{card.preview?.siteName ?? host(card.url)}</span>
            </div>
            <div className="font-semibold leading-snug text-foreground">{card.preview?.title ?? host(card.url)}</div>
            {card.preview?.description && <p className="line-clamp-3 text-xs text-muted-foreground">{card.preview.description}</p>}
            {!card.preview && <p className="text-xs text-muted-foreground">No preview available for this page.</p>}
          </div>
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs">
            <span className="truncate text-muted-foreground">{card.url}</span>
            <a href={card.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 font-medium text-info hover:underline">
              Open link <ExternalLink className="size-3" />
            </a>
          </div>
        </>
      )}
    </div>
  ) : null;

  return node;
}
