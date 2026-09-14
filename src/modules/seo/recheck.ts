/** Manual PageSpeed rechecks are rate-limited per subscription, derived from the last stored audit. */
export const RECHECK_COOLDOWN_MS = 60_000;

export function recheckAllowed(
  lastFetchedAt: Date | string | null | undefined,
  now: Date = new Date(),
  cooldownMs: number = RECHECK_COOLDOWN_MS,
): { allowed: true } | { allowed: false; retryInSeconds: number } {
  if (!lastFetchedAt) return { allowed: true };
  const elapsed = now.getTime() - new Date(lastFetchedAt).getTime();
  if (elapsed >= cooldownMs) return { allowed: true };
  return { allowed: false, retryInSeconds: Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000)) };
}
