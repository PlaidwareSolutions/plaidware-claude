/** Pure classification for the uptime probe — no fetch, no DB. */

export type ProbeStatus = "healthy" | "degraded" | "down";

export const HEALTH_PATH = "/api/system/health";

/**
 * A site is probed at /api/system/health first. Products the Hub builds
 * expose it; a client's own application usually does not — a 404 there says
 * nothing about the site, so the probe falls back to the homepage and grades
 * that instead. 5xx anywhere is down; other non-2xx is degraded.
 */
export function classifyProbe(
  health: { status: number } | { error: string },
  home?: { status: number } | { error: string } | null,
): { status: ProbeStatus; statusCode: number | null; detail: string | null; usedHomepage: boolean } {
  if ("error" in health) {
    return { status: "down", statusCode: null, detail: health.error.slice(0, 200), usedHomepage: false };
  }
  if (health.status !== 404 || !home) {
    return { status: grade(health.status), statusCode: health.status, detail: null, usedHomepage: false };
  }
  if ("error" in home) {
    return { status: "down", statusCode: null, detail: `No ${HEALTH_PATH} endpoint; homepage failed: ${home.error.slice(0, 160)}`, usedHomepage: true };
  }
  return {
    status: grade(home.status),
    statusCode: home.status,
    detail: `No ${HEALTH_PATH} endpoint — graded on the homepage (HTTP ${home.status})`,
    usedHomepage: true,
  };
}

function grade(status: number): ProbeStatus {
  if (status >= 200 && status < 300) return "healthy";
  if (status >= 500) return "down";
  return "degraded";
}
