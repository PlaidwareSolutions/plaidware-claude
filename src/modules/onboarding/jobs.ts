import type { PgBoss } from "pg-boss";
import { expirePendingInvites } from "./service";

/** Setup links die 14 days after minting; this flips the rows and drops held prices. */
export const ONBOARDING_SCHEDULE = {
  expireInvites: { queue: "onboarding.expire-invites", cron: "0 5 * * *", hourUtc: 5 },
} as const;

export async function registerOnboardingJobs(boss: PgBoss): Promise<string[]> {
  await boss.createQueue(ONBOARDING_SCHEDULE.expireInvites.queue);
  await boss.schedule(ONBOARDING_SCHEDULE.expireInvites.queue, ONBOARDING_SCHEDULE.expireInvites.cron);
  await boss.work(ONBOARDING_SCHEDULE.expireInvites.queue, async () => {
    const n = await expirePendingInvites();
    console.log(`[onboarding] expired ${n} setup link${n === 1 ? "" : "s"}`);
  });
  return [ONBOARDING_SCHEDULE.expireInvites.queue];
}
