import type { PgBoss } from "pg-boss";
import { stripeConfigured } from "../../lib/stripe";
import { generateHostingInvoices, runDunningSweep, sendPreDueReminders } from "./ar-service";

export async function registerBillingJobs(boss: PgBoss): Promise<string[]> {
  if (!stripeConfigured()) return [];

  // Daily dunning sweep (PRD §4.5): reminders 3/7/14 days past due, then suspend.
  await boss.createQueue("billing.dunning-sweep");
  await boss.schedule("billing.dunning-sweep", "0 14 * * *"); // 14:00 UTC daily
  await boss.work("billing.dunning-sweep", async () => {
    const pre = await sendPreDueReminders();
    const r = await runDunningSweep();
    console.log(
      `[billing] dunning sweep: pre-due ${pre}, opened ${r.opened}, reminded ${r.reminded}, suspended ${r.suspended}`,
    );
  });

  // Hosting invoices for the previous month, on the 1st (PRD §4.5).
  await boss.createQueue("billing.hosting-invoices");
  await boss.schedule("billing.hosting-invoices", "0 8 1 * *"); // 08:00 UTC on the 1st
  await boss.work("billing.hosting-invoices", async () => {
    const r = await generateHostingInvoices();
    console.log(`[billing] hosting invoices: created ${r.created}, skipped ${r.skipped}`);
  });

  return ["billing.dunning-sweep", "billing.hosting-invoices"];
}
