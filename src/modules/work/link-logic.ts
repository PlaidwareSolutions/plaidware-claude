import type { WorkLinkType } from "./contracts";

/**
 * Jira's issue links. A row is stored from its outward side (source blocks
 * target); each end reads it with its own phrase. Pure: shared by the
 * service, the queries and the link picker.
 */

export type LinkDirection = "outward" | "inward";

const PHRASES: Record<WorkLinkType, { outward: string; inward: string }> = {
  blocks: { outward: "blocks", inward: "is blocked by" },
  relates: { outward: "relates to", inward: "relates to" },
  duplicates: { outward: "duplicates", inward: "is duplicated by" },
  clones: { outward: "clones", inward: "is cloned by" },
};

/** How this item reads the link: "FIXO-3 blocks …" / "FIXO-3 is blocked by …". */
export function linkPhrase(type: WorkLinkType, direction: LinkDirection): string {
  // "relates" has no direction: both ends say "relates to".
  return PHRASES[type][type === "relates" ? "outward" : direction];
}

/** The picker's options, in Jira's order: one per distinct phrase. */
export const LINK_CHOICES: { type: WorkLinkType; direction: LinkDirection; label: string }[] = [
  { type: "blocks", direction: "outward", label: "blocks" },
  { type: "blocks", direction: "inward", label: "is blocked by" },
  { type: "relates", direction: "outward", label: "relates to" },
  { type: "duplicates", direction: "outward", label: "duplicates" },
  { type: "duplicates", direction: "inward", label: "is duplicated by" },
  { type: "clones", direction: "outward", label: "clones" },
  { type: "clones", direction: "inward", label: "is cloned by" },
];

/** The stored row for "this item <phrase> other". */
export function linkRow(o: { itemId: string; otherItemId: string; type: WorkLinkType; direction: LinkDirection }): { sourceItemId: string; targetItemId: string; type: WorkLinkType } {
  const outward = o.type === "relates" || o.direction === "outward";
  return { sourceItemId: outward ? o.itemId : o.otherItemId, targetItemId: outward ? o.otherItemId : o.itemId, type: o.type };
}

/** Group order on the item page: blockers first, then the rest. */
const GROUP_ORDER = ["is blocked by", "blocks", "relates to", "duplicates", "is duplicated by", "clones", "is cloned by"];
export function linkGroupRank(phrase: string): number {
  const i = GROUP_ORDER.indexOf(phrase);
  return i < 0 ? GROUP_ORDER.length : i;
}

/** "FIXO-12" (any case, optional spaces) → { prefix, number }; anything else is a title search. */
export function parseItemKey(q: string): { prefix: string; number: number } | null {
  const m = /^\s*([A-Za-z][A-Za-z0-9]{1,5})\s*-\s*(\d{1,7})\s*$/.exec(q);
  return m ? { prefix: m[1].toUpperCase(), number: Number(m[2]) } : null;
}

/** Jira prefixes a clone's summary. */
export function cloneTitle(title: string): string {
  return `CLONE - ${title}`.slice(0, 300);
}
