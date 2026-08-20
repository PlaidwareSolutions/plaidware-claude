import type { PgBoss } from "pg-boss";
import { env } from "../../env";
import { stripeConfigured } from "../../lib/stripe";
import { sweepOrphanCoupons } from "./service";

/** Daily orphan-coupon sweep — the backstop behind checkout-failure cleanup. */
export async function registerPromoJobs(boss: PgBoss): Promise<string[]> {
  if (env.PROMOS_ENABLED !== "true") return [];
  if (!stripeConfigured()) return [];
  await boss.createQueue("promos.orphan-sweep");
  await boss.schedule("promos.orphan-sweep", "0 9 * * *"); // daily 09:00 UTC
  await boss.work("promos.orphan-sweep", async () => {
    const r = await sweepOrphanCoupons();
    console.log(`[promos] orphan sweep: scanned ${r.scanned}, deleted ${r.deleted}`);
  });
  return ["promos.orphan-sweep"];
}
