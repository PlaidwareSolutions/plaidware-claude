import sanitizeHtml from "sanitize-html";
import { isRichHtml, isRichTextEmpty, plainToHtml } from "./rich-text";

/**
 * Server-side allowlist for editor HTML. Runs on every write (service) and
 * again on every read (queries), so a stored value can never smuggle script,
 * styles, event handlers or javascript: URLs to another viewer. The tags are
 * exactly what the editor produces (StarterKit + task lists + images).
 */

/** Our own uploads (see WORK.attachment). */
const ATTACHMENT_SRC = /^\/api\/work\/attachments\/[0-9a-f-]{36}$/;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "b", "em", "i", "u", "s", "code", "pre", "blockquote",
    "h1", "h2", "h3", "ul", "ol", "li", "a", "img", "hr", "label", "input", "div", "span",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "title"],
    ol: ["start"],
    ul: ["data-type"],
    li: ["data-type", "data-checked"],
    input: ["type", "checked", "disabled"],
    pre: ["class"],
    code: ["class"],
  },
  allowedClasses: { pre: [/^language-[\w-]+$/], code: [/^language-[\w-]+$/] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  exclusiveFilter: (frame) =>
    // Images: only https or our attachment route; checkboxes: only task-list checkboxes.
    (frame.tag === "img" && !(frame.attribs.src && (ATTACHMENT_SRC.test(frame.attribs.src) || frame.attribs.src.startsWith("https://")))) ||
    (frame.tag === "input" && frame.attribs.type !== "checkbox"),
  transformTags: {
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" } }),
    // Runs before exclusiveFilter: keep the type so a non-checkbox input is still dropped there.
    input: (tagName, attribs) => ({ tagName, attribs: { ...attribs, disabled: "" } }),
  },
};

export function sanitizeRichHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}

/**
 * Normalise a description/comment for storage: editor HTML is sanitised,
 * plain text (imports, the Partner API, old clients) is kept as typed, and
 * an empty editor ("<p></p>") becomes "".
 */
export function normalizeRichText(input: string): string {
  if (!isRichHtml(input)) return input.trim();
  // Drop the empty paragraphs an editor leaves after a trailing image or list.
  const clean = sanitizeRichHtml(input)
    .replace(/(<p>(\s|&nbsp;|<br \/>)*<\/p>\s*)+$/, "")
    .trim();
  return isRichTextEmpty(clean) ? "" : clean;
}

/** Stored value → HTML that is safe to render (plain text is escaped into paragraphs). */
export function renderRichText(stored: string | null | undefined): string {
  if (!stored) return "";
  return isRichHtml(stored) ? sanitizeRichHtml(stored) : plainToHtml(stored);
}
