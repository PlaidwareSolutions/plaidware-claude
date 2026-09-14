/**
 * Curated product icons (lucide names) — a closed list so the marketing site
 * and ops pages can render them without a dynamic import.
 */
export const PRODUCT_ICONS = [
  "globe",
  "hammer",
  "wrench",
  "car",
  "building-2",
  "home",
  "megaphone",
  "bar-chart-3",
  "shopping-cart",
  "briefcase",
  "layout-template",
  "sparkles",
] as const;

export type ProductIcon = (typeof PRODUCT_ICONS)[number];

export function isProductIcon(v: string | null | undefined): v is ProductIcon {
  return !!v && (PRODUCT_ICONS as readonly string[]).includes(v);
}
