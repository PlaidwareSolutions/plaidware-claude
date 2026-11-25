import type { WorkItemType } from "../work/contracts";
import { escapeHtml } from "../work/rich-text";

/**
 * How a partner app's user report becomes a work ticket (POST /work-items).
 * Pure: the ticket's type, labels, title and description body. Every value
 * from the partner is escaped here; the result still goes through the work
 * module's sanitiser on write.
 *
 * The body never names the client: developers read tickets, and a client
 * reaches them only through workspace membership (the ops-only requester
 * field). So no shop name and no reporter email here — the reporter's role
 * and a link back to the original report are what ops follow up with.
 */

export type ReportKind = "bug" | "feedback" | "idea";

export const REPORT_KIND_LABELS: Record<ReportKind, string> = { bug: "Bug report", feedback: "Feedback", idea: "Idea" };

export function workItemTypeFor(kind: ReportKind): WorkItemType {
  if (kind === "bug") return "bug";
  if (kind === "idea") return "feature";
  return "enhancement";
}

/** Labels that let the board filter these: the app's name and the report kind. */
export function reportLabels(appName: string, kind: ReportKind): string[] {
  return [`${appName}-report`, kind === "bug" ? "bug-report" : kind];
}

const TITLE_MAX = 120;

/** The partner's title, else the message's first line, cut at a word near 120 chars. */
export function reportTitle(o: { title?: string | null; message: string; kind: ReportKind }): string {
  const given = o.title?.trim();
  if (given) return given.slice(0, 200);
  const first = o.message.trim().split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  if (!first) return REPORT_KIND_LABELS[o.kind];
  if (first.length <= TITLE_MAX) return first;
  const cut = first.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > 60 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export type ReportDetails = {
  kind: ReportKind;
  message: string;
  appDisplayName: string;
  /** The reporter's role in the partner app (owner, technician…). */
  reporterRole?: string | null;
  page?: { path?: string | null; name?: string | null } | null;
  userAgent?: string | null;
  viewport?: { width: number; height: number } | null;
  reportUrl?: string | null;
  /** Hub's own attachment URL (already stored), when a screenshot came with the report. */
  screenshotSrc?: string | null;
};

/** The ticket body: the reporter's words, the screenshot, then a details list. */
export function reportDescriptionHtml(d: ReportDetails): string {
  const paragraphs = d.message
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((p) => `<p>${p.split(/\r?\n/).map(escapeHtml).join("<br>")}</p>`)
    .join("");

  const rows: [string, string][] = [];
  const role = d.reporterRole?.trim();
  if (role) rows.push(["Reported by", escapeHtml(role.replace(/_/g, " "))]);
  const pageName = d.page?.name?.trim();
  const pagePath = d.page?.path?.trim();
  if (pageName || pagePath) {
    rows.push(["Page", pageName && pagePath ? `${escapeHtml(pageName)} — <code>${escapeHtml(pagePath)}</code>` : pageName ? escapeHtml(pageName) : `<code>${escapeHtml(pagePath!)}</code>`]);
  }
  if (d.userAgent) rows.push(["Browser", escapeHtml(d.userAgent)]);
  if (d.viewport) rows.push(["Screen", `${d.viewport.width} × ${d.viewport.height}`]);
  if (d.reportUrl) rows.push(["Original report", `<a href="${escapeHtml(d.reportUrl)}">Open in ${escapeHtml(d.appDisplayName)}</a>`]);

  const screenshot = d.screenshotSrc ? `<p><img src="${escapeHtml(d.screenshotSrc)}" alt="Screenshot"></p>` : "";
  const details = rows.length === 0 ? "" : `<h3>Details</h3><ul>${rows.map(([k, v]) => `<li><p><strong>${k}:</strong> ${v}</p></li>`).join("")}</ul>`;
  return `<p><em>${REPORT_KIND_LABELS[d.kind]} from ${escapeHtml(d.appDisplayName)}</em></p>${paragraphs}${screenshot}${details}`;
}

/** Decode the partner's base64 screenshot; null when it isn't base64 at all. */
export function decodeScreenshot(b64: string): Uint8Array | null {
  const clean = b64.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  return new Uint8Array(Buffer.from(clean, "base64"));
}
