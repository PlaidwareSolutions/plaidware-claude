import type { PgBoss } from "pg-boss";
import { formatDateTime } from "../../lib/dates";
import { env } from "../../env";
import { emailShell, sendEmail } from "../../lib/email";
import { findQuietReporters, pruneTimeSeries, runUptimeProbe } from "./service";
import { MONITORING_SCHEDULE as S } from "./schedule";

export async function registerMonitoringJobs(boss: PgBoss): Promise<string[]> {
  await boss.createQueue(S.uptimeProbe.queue);
  await boss.schedule(S.uptimeProbe.queue, S.uptimeProbe.cron);
  await boss.work(S.uptimeProbe.queue, async () => {
    const r = await runUptimeProbe();
    if (r.probed > 0) console.log(`[monitoring] probed ${r.probed}, down ${r.down}`);
  });

  await boss.createQueue(S.prune.queue);
  await boss.schedule(S.prune.queue, S.prune.cron);
  await boss.work(S.prune.queue, async () => {
    const r = await pruneTimeSeries();
    console.log(`[monitoring] pruned`, r);
  });

  await boss.createQueue(S.quietReporters.queue);
  await boss.schedule(S.quietReporters.queue, S.quietReporters.cron);
  await boss.work(S.quietReporters.queue, async () => {
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
                `<li><strong>${q.productName}</strong> — last seen ${q.lastSeen ? formatDateTime(q.lastSeen) : "never"} (threshold ${q.thresholdMinutes} min)</li>`,
            )
            .join("") +
          `</ul>`,
      ),
    });
  });

  return [S.uptimeProbe.queue, S.prune.queue, S.quietReporters.queue];
}
