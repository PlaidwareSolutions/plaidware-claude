import type { PgBoss } from "pg-boss";
import { env } from "../../env";
import { runSeoSweep } from "./service";

export async function registerSeoJobs(boss: PgBoss): Promise<string[]> {
  if (!env.PAGESPEED_INSIGHTS_API_KEY) return [];
  await boss.createQueue("seo.sweep");
  await boss.schedule("seo.sweep", "0 10 * * *"); // daily 10:00 UTC
  await boss.work("seo.sweep", async () => {
    const r = await runSeoSweep();
    console.log(`[seo] swept ${r.audited} subscriptions, ${r.failed} failed`);
  });
  return ["seo.sweep"];
}
