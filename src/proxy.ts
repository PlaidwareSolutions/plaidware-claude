import { NextRequest, NextResponse } from "next/server";

/**
 * Domain split (PRD post-launch):
 *   plaidware.com     → marketing only (/, /platform, /products*, /contact, legal)
 *   hub.plaidware.com → the app; marketing paths bounce to the apex, and "/"
 *                       routes by session: signed-in → /dashboard, else apex.
 * Staging/preview hosts are untouched.
 */

const MARKETING = "https://plaidware.com";
const HUB = "https://hub.plaidware.com";

const MARKETING_PATHS = new Set(["/", "/platform", "/contact", "/privacy", "/terms"]);
const isMarketingPath = (p: string) => MARKETING_PATHS.has(p) || p.startsWith("/products");

function hasSessionCookie(req: NextRequest): boolean {
  return Boolean(
    req.cookies.get("__Secure-better-auth.session_token") ??
      req.cookies.get("better-auth.session_token"),
  );
}

export function proxy(req: NextRequest) {
  const host = req.headers.get("host")?.toLowerCase() ?? "";
  const path = req.nextUrl.pathname;

  if (host === "www.plaidware.com") {
    return NextResponse.redirect(`${MARKETING}${path}${req.nextUrl.search}`, 301);
  }

  if (host === "plaidware.com") {
    if (isMarketingPath(path) || path === "/sitemap.xml" || path === "/robots.txt") {
      return NextResponse.next();
    }
    // App paths (login, dashboard, checkout, api, …) live on the hub.
    return NextResponse.redirect(`${HUB}${path}${req.nextUrl.search}`, 308);
  }

  if (host === "hub.plaidware.com") {
    if (path === "/") {
      return hasSessionCookie(req)
        ? NextResponse.redirect(`${HUB}/dashboard`)
        : NextResponse.redirect(MARKETING, 302);
    }
    if (isMarketingPath(path)) {
      return NextResponse.redirect(`${MARKETING}${path}${req.nextUrl.search}`, 308);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets and images; API routes must pass through untouched.
  matcher: ["/((?!_next/|images/|favicon|plaidware-logo|api/).*)"],
};
