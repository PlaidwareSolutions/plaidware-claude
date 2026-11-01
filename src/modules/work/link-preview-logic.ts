/**
 * Link hover previews (Jira's smart-link card): which addresses the server may
 * fetch, and how a page's <title>/OpenGraph tags become a preview. Pure; the
 * fetching (with these checks applied to every resolved address) lives in
 * link-preview.ts.
 */

export type LinkPreview = { url: string; title: string | null; description: string | null; siteName: string | null; image: string | null };

/** Only public web addresses: http(s) on the default ports, no credentials. */
export function previewableUrl(input: string): URL | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return null;
  return u;
}

/** True for loopback, private, link-local, carrier-NAT, multicast, reserved and metadata addresses (v4 and v6). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
const decode = (s: string) =>
  s
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/\s+/g, " ")
    .trim();

const clip = (s: string | null, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

function meta(html: string, keys: string[]): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (!key || !keys.includes(key)) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return decode(content);
  }
  return null;
}

/** Title, description, site and image from a page's <head>; the image only if it's https. */
export function parseLinkMeta(html: string, pageUrl: string): LinkPreview {
  const head = html.slice(0, 200_000);
  const title = meta(head, ["og:title", "twitter:title"]) ?? (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ? decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)![1]) : null);
  const description = meta(head, ["og:description", "twitter:description", "description"]);
  const siteName = meta(head, ["og:site_name", "application-name"]);
  let image = meta(head, ["og:image", "og:image:url", "twitter:image"]);
  if (image) {
    try {
      const abs = new URL(image, pageUrl);
      image = abs.protocol === "https:" ? abs.toString() : null;
    } catch {
      image = null;
    }
  }
  return { url: pageUrl, title: clip(title || null, 200), description: clip(description, 300), siteName: clip(siteName, 80), image };
}
