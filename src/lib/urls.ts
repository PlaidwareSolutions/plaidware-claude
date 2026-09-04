/**
 * Absolute origin for app (hub) routes. Marketing pages render on the apex
 * domain in production, so their CTAs into the app must be absolute; staging
 * serves marketing and app from one host, where APP_BASE_URL points at it.
 */
export function hubUrl(path: string): string {
  const base = process.env.APP_BASE_URL ?? "https://hub.plaidware.com";
  return `${base.replace(/\/$/, "")}${path}`;
}
