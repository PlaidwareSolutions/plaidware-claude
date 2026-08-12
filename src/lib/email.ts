import { Resend } from "resend";
import { env } from "../env";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/**
 * All outbound mail goes through here. Without an API key (local dev without
 * credentials) the message is logged instead of sent, so auth flows remain
 * testable — the verification URL shows up in the server log.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ sent: boolean; error?: string }> {
  if (!resend) {
    console.log(
      `[email:dev] to=${opts.to} subject="${opts.subject}"\n${opts.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`,
    );
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  if (error) {
    console.error(`[email] send failed to=${opts.to}: ${error.message}`);
    return { sent: false, error: error.message };
  }
  return { sent: true };
}

/** Minimal brand shell for M1 transactional mail; react-email templates land in M2. */
export function emailShell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#060913;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#0d1326;border:1px solid #232b47;border-radius:12px;padding:32px">
    <p style="color:#f0663f;font-size:11px;letter-spacing:.22em;text-transform:uppercase;margin:0 0 16px">Plaidware</p>
    <h1 style="color:#f2f4fb;font-size:20px;margin:0 0 16px">${title}</h1>
    <div style="color:#d7dcee;font-size:15px;line-height:1.6">${bodyHtml}</div>
  </div>
  <p style="color:#8b93b2;font-size:12px;text-align:center;margin-top:16px">Plaidware Solutions · Accelerating business throughput</p>
</body></html>`;
}

export function emailButton(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${url}" style="background:#5b4ee0;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block">${label}</a></p>
  <p style="color:#8b93b2;font-size:13px;word-break:break-all">Or paste this link into your browser:<br>${url}</p>`;
}
