import type { PgBoss } from "pg-boss";
import { env } from "../../env";
import { currentMonth, syncRailwayCosts } from "./service";
import { COSTS_SCHEDULE } from "../monitoring/schedule";

export async function registerCostJobs(boss: PgBoss): Promise<string[]> {
  if (!env.RAILWAY_API_TOKEN) return [];
  await boss.createQueue(COSTS_SCHEDULE.railwaySync.queue);
  await boss.schedule(COSTS_SCHEDULE.railwaySync.queue, COSTS_SCHEDULE.railwaySync.cron); // daily 07:00 UTC
  await boss.work(COSTS_SCHEDULE.railwaySync.queue, async () => {
    const r = await syncRailwayCosts(currentMonth());
    console.log(`[costs] railway sync: ${r.apps} apps, $${(r.totalCents / 100).toFixed(2)} MTD`);
  });
  return [COSTS_SCHEDULE.railwaySync.queue];
}
