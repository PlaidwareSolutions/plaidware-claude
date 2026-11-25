import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { isPrivateAddress, parseLinkMeta, previewableUrl, type LinkPreview } from "./link-preview-logic";

/**
 * Server-side fetch for link hover previews. Every hostname is resolved first
 * and refused if ANY address is private/internal; the connection is then
 * pinned to an address we checked (no DNS-rebinding swap). Redirects are
 * followed by hand (max 3) and re-checked; HTML only, 512 KB, 4 s.
 */

const TIMEOUT_MS = 4000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: LinkPreview | null }>();

async function vettedAddress(hostname: string): Promise<{ address: string; family: number } | null> {
  const addrs = await lookup(hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return null;
  return addrs[0];
}

function fetchOnce(url: URL, pinned: { address: string; family: number }): Promise<{ status: number; location?: string; type: string; body: string }> {
  // Connect only to the address we vetted, whatever DNS says now.
  const pinnedLookup = ((_host: string, opts: unknown, cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void) => {
    if (opts && typeof opts === "object" && (opts as { all?: boolean }).all) cb(null, [pinned]);
    else cb(null, pinned.address, pinned.family);
  }) as unknown as LookupFunction;
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(
      url,
      { lookup: pinnedLookup, timeout: TIMEOUT_MS, headers: { "user-agent": "PlaidwareHub-LinkPreview/1.0", accept: "text/html,application/xhtml+xml" } },
      (res) => {
        const type = String(res.headers["content-type"] ?? "");
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, location: res.headers.location, type, body: "" });
          return;
        }
        if (!/text\/html|application\/xhtml/i.test(type)) {
          res.destroy();
          resolve({ status, type, body: "" });
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on("close", () => resolve({ status, type, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

/** The preview for a public web page, or null (not previewable, blocked, unreachable, not HTML). Cached for an hour. */
export async function fetchLinkPreview(input: string): Promise<LinkPreview | null> {
  const hit = cache.get(input);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: LinkPreview | null = null;
  try {
    let url = previewableUrl(input);
    for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
      const pinned = await vettedAddress(url.hostname);
      if (!pinned) break;
      const res = await fetchOnce(url, pinned);
      if (res.location && res.status >= 300 && res.status < 400) {
        url = previewableUrl(new URL(res.location, url).toString());
        continue;
      }
      if (res.status >= 200 && res.status < 300 && res.body) value = parseLinkMeta(res.body, url.toString());
      break;
    }
  } catch {
    value = null;
  }
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  cache.set(input, { at: Date.now(), value });
  return value;
}
