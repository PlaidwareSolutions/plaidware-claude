import type { PgBoss } from "pg-boss";
import { runWorkNotifications } from "./notify-service";

/** Work emails (assigned, mentioned, comments, status, flags): drained every minute, batched per person per item. */
export async function registerWorkJobs(boss: PgBoss): Promise<string[]> {
  await boss.createQueue("work.notify");
  await boss.schedule("work.notify", "* * * * *");
  await boss.work("work.notify", async () => {
    const r = await runWorkNotifications();
    if (r.emails || r.failed) console.log(`[work] notifications: ${r.emails} sent, ${r.failed} failed (${r.events} events)`);
  });
  return ["work.notify"];
}
