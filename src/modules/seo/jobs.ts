import type { PgBoss } from "pg-boss";
import { env } from "../../env";
import { runSeoSweep } from "./service";
import { SEO_SCHEDULE } from "../monitoring/schedule";

export async function registerSeoJobs(boss: PgBoss): Promise<string[]> {
  if (!env.PAGESPEED_INSIGHTS_API_KEY) return [];
  await boss.createQueue(SEO_SCHEDULE.sweep.queue);
  await boss.schedule(SEO_SCHEDULE.sweep.queue, SEO_SCHEDULE.sweep.cron); // daily 10:00 UTC
  await boss.work(SEO_SCHEDULE.sweep.queue, async () => {
    const r = await runSeoSweep();
    console.log(`[seo] swept ${r.audited} subscriptions, ${r.failed} failed`);
  });
  return [SEO_SCHEDULE.sweep.queue];
}
