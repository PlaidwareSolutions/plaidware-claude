import { cookies } from "next/headers";
import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";

/**
 * Copies the Set-Cookie headers of an `auth.api.*({ returnHeaders: true })`
 * call onto the current server-action response. Better Auth's nextCookies()
 * plugin does this for every call and also changes get-session's refresh
 * behaviour in RSC renders; only the two calls that swap the browser's
 * session cookie (start / stop view-as) need it, so it is done here, locally.
 * Later entries for the same cookie name win — right for expire-then-set.
 */
export async function applyAuthCookies(h: Headers): Promise<void> {
  const raw = h.get("set-cookie");
  if (!raw) return;
  const store = await cookies();
  parseSetCookieHeader(raw).forEach((value, name) => {
    if (!name) return;
    store.set(name, value.value, toCookieOptions(value));
  });
}
