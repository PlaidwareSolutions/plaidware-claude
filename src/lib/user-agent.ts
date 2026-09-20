/**
 * A short, human label for a session's user agent ("Chrome on macOS"),
 * for the device lists on the account page and the ops user page.
 * Best effort and library-free: browser families that embed other tokens
 * (Edge and Opera carry "Chrome/" and "Safari/") are tested first.
 */
export type UserAgentInfo = { browser: string | null; os: string | null; label: string };

export function describeUserAgent(ua: string | null | undefined): UserAgentInfo {
  const s = ua ?? "";
  const browser = /\bEdg(?:e|A|iOS)?\//.test(s)
    ? "Edge"
    : /\bOPR\/|\bOpera\b/.test(s)
      ? "Opera"
      : /SamsungBrowser/.test(s)
        ? "Samsung Internet"
        : /\bFirefox\/|\bFxiOS\//.test(s)
          ? "Firefox"
          : /\bChrome\/|\bCriOS\//.test(s)
            ? "Chrome"
            : /\bSafari\//.test(s)
              ? "Safari"
              : null;
  const os = /iPhone|iPod/.test(s)
    ? "iOS"
    : /iPad/.test(s)
      ? "iPadOS"
      : /Android/.test(s)
        ? "Android"
        : /Windows NT/.test(s)
          ? "Windows"
          : /Mac OS X/.test(s)
            ? "macOS"
            : /CrOS/.test(s)
              ? "ChromeOS"
              : /Linux/.test(s)
                ? "Linux"
                : null;
  const label = browser && os ? `${browser} on ${os}` : (browser ?? os ?? "Unknown device");
  return { browser, os, label };
}
