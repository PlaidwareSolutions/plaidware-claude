import type { PgBoss } from "pg-boss";
import { env } from "../../env";
import { emailShell, sendEmail } from "../../lib/email";
import { findQuietReporters, pruneTimeSeries, runUptimeProbe } from "./service";

export async function registerMonitoringJobs(boss: PgBoss): Promise<string[]> {
  await boss.createQueue("monitoring.uptime-probe");
  await boss.schedule("monitoring.uptime-probe", "*/5 * * * *");
  await boss.work("monitoring.uptime-probe", async () => {
    const r = await runUptimeProbe();
    if (r.probed > 0) console.log(`[monitoring] probed ${r.probed}, down ${r.down}`);
  });

  await boss.createQueue("monitoring.prune");
  await boss.schedule("monitoring.prune", "30 6 * * *");
  await boss.work("monitoring.prune", async () => {
    const r = await pruneTimeSeries();
    console.log(`[monitoring] pruned`, r);
  });

  await boss.createQueue("monitoring.quiet-reporters");
  await boss.schedule("monitoring.quiet-reporters", "0 15 * * *");
  await boss.work("monitoring.quiet-reporters", async () => {
    const quiet = await findQuietReporters();
    console.log(`[monitoring] quiet reporters: ${quiet.length}`);
    if (quiet.length === 0 || !env.OPS_EMAIL) return;
    await sendEmail({
      to: env.OPS_EMAIL,
      subject: `[Plaidware ops] ${quiet.length} quiet reporter${quiet.length === 1 ? "" : "s"}`,
      html: emailShell(
        "Reporters gone quiet",
        `<p>These subscriptions haven't reported metrics within their freshness window:</p><ul>` +
          quiet
            .map(
              (q) =>
                `<li><strong>${q.productName}</strong> — last seen ${q.lastSeen ? new Date(q.lastSeen).toLocaleString() : "never"} (threshold ${q.thresholdMinutes} min)</li>`,
            )
            .join("") +
          `</ul>`,
      ),
    });
  });

  return ["monitoring.uptime-probe", "monitoring.prune", "monitoring.quiet-reporters"];
}
