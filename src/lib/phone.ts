/**
 * Phone handling for onboarding + ops member management. Accounts minted from
 * a setup link used to carry a fixed placeholder; anything that still does is
 * flagged in the UI as "not collected".
 */
export const PLACEHOLDER_PHONE = "+10000000000";

export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  return !phone || phone === PLACEHOLDER_PHONE || /^\+?0+$/.test(phone);
}

/**
 * Loose E.164 normalization: keeps a leading "+", strips punctuation, assumes
 * US for 10-digit input. Returns null when the digits can't be a phone number.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/** "+15551234567" → "(555) 123-4567"; other countries stay E.164. */
export function formatPhone(phone: string | null | undefined): string {
  if (isPlaceholderPhone(phone)) return "—";
  const p = phone!;
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p;
}
