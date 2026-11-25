/**
 * @mentions in work rich text. The editor writes
 * <span data-type="mention" data-id="<userId>" data-label="Name">@Name</span>;
 * the sanitiser keeps exactly those attributes, and the service reads the ids
 * here to notify and auto-watch the people mentioned. Pure.
 */

const MENTION_SPAN = /<span\b[^>]*\bdata-type="mention"[^>]*>/gi;
const DATA_ID = /\bdata-id="([^"]{1,100})"/i;

export function extractMentionIds(html: string | null | undefined): string[] {
  if (!html) return [];
  const ids = new Set<string>();
  for (const tag of html.match(MENTION_SPAN) ?? []) {
    const id = DATA_ID.exec(tag)?.[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Mentions present in `after` but not in `before` (an edit only notifies the newly mentioned). */
export function newMentionIds(before: string | null | undefined, after: string | null | undefined): string[] {
  const had = new Set(extractMentionIds(before));
  return extractMentionIds(after).filter((id) => !had.has(id));
}
