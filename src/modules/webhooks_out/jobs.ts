import type { PgBoss } from "pg-boss";
import { runDueDeliveries } from "./service";

export async function registerWebhookJobs(boss: PgBoss): Promise<string[]> {
  await boss.createQueue("webhooks.deliver-due");
  await boss.schedule("webhooks.deliver-due", "* * * * *");
  await boss.work("webhooks.deliver-due", async () => {
    const r = await runDueDeliveries();
    if ("skipped" in r || r.attempted === 0) return;
    console.log(
      `[webhooks_out] delivered ${r.delivered}/${r.attempted} (retrying ${r.retried}, dead ${r.dead}, disabled ${r.disabled})`,
    );
  });
  return ["webhooks.deliver-due"];
}
