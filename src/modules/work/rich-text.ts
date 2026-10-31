/**
 * Rich text for work item descriptions and comments. Stored as HTML produced
 * by the editor (and sanitised server-side — see rich-text-sanitize.ts);
 * anything that doesn't start with a tag is legacy/imported plain text and
 * is shown escaped. Pure: imported by the editor, the views and the tests.
 */

/** Editor output and sanitised HTML always start with a tag; plain text never does (we escape it). */
export function isRichHtml(s: string): boolean {
  return s.trimStart().startsWith("<");
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Plain text → paragraphs (blank line) and line breaks (single newline). */
export function plainToHtml(s: string): string {
  const text = s.replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** What the editor and the view start from, whichever way the text was stored. */
export function toRichHtml(s: string | null | undefined): string {
  if (!s) return "";
  return isRichHtml(s) ? s : plainToHtml(s);
}

/** Visible text of stored rich text (tags dropped, entities decoded) — for emptiness checks and previews. */
export function richTextToPlain(s: string): string {
  if (!isRichHtml(s)) return s.trim();
  return s
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/blockquote|\/pre|hr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when there's nothing to keep: no text and no image/divider/checkbox. */
export function isRichTextEmpty(s: string): boolean {
  if (!s.trim()) return true;
  if (!isRichHtml(s)) return false;
  if (/<(img|hr|input)\b/i.test(s)) return false;
  return richTextToPlain(s) === "";
}
