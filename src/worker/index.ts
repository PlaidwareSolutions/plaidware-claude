import { PgBoss } from "pg-boss";
import { env } from "../env";
import { registerPromoJobs } from "../modules/promos/jobs";

/**
 * Background job runner — a separate Railway service sharing the same image
 * and Postgres. Each module contributes jobs via its jobs.ts; they register
 * here as milestones land.
 */
async function main() {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
  });
  boss.on("error", (err) => console.error("[worker] pg-boss error:", err));

  await boss.start();

  // Heartbeat proves scheduling end-to-end until real jobs land (M5+).
  await boss.createQueue("heartbeat");
  await boss.schedule("heartbeat", "*/15 * * * *");
  await boss.work("heartbeat", async () => {
    console.log(`[worker] heartbeat ${new Date().toISOString()}`);
  });

  const promoQueues = await registerPromoJobs(boss);

  console.log(`[worker] started; queues: heartbeat${promoQueues.map((q) => `, ${q}`).join("")}`);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
