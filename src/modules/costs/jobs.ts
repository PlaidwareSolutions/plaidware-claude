import type { PgBoss } from "pg-boss";
import { env } from "../../env";
import { currentMonth, syncRailwayCosts } from "./service";

export async function registerCostJobs(boss: PgBoss): Promise<string[]> {
  if (!env.RAILWAY_API_TOKEN) return [];
  await boss.createQueue("costs.railway-sync");
  await boss.schedule("costs.railway-sync", "0 7 * * *"); // daily 07:00 UTC
  await boss.work("costs.railway-sync", async () => {
    const r = await syncRailwayCosts(currentMonth());
    console.log(`[costs] railway sync: ${r.apps} apps, $${(r.totalCents / 100).toFixed(2)} MTD`);
  });
  return ["costs.railway-sync"];
}
