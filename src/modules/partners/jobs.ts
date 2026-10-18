import type { PgBoss } from "pg-boss";
import { purgePartnerLedgers } from "./service";

/** Daily Partner API housekeeping: idempotency ledger + stale pay links. */
export async function registerPartnerJobs(boss: PgBoss): Promise<string[]> {
  await boss.createQueue("partners.purge-ledgers");
  await boss.schedule("partners.purge-ledgers", "30 4 * * *"); // daily 04:30 UTC
  await boss.work("partners.purge-ledgers", async () => {
    const r = await purgePartnerLedgers();
    console.log(`[partners] purged ${r.idempotency} idempotency rows, ${r.payLinks} pay links`);
  });
  return ["partners.purge-ledgers"];
}
