/** Pure dunning decisions (PRD §4.5, Q2 defaults) — no DB, no Stripe. */

export type BillingPolicyLike = {
  reminderDays: number[]; // e.g. [3, 7, 14]
  graceDays: number; // suspension threshold
  autoSuspend: boolean;
};

export type DunningCaseLike = {
  remindersSent: number;
  suspendedAt: Date | null;
  paused: boolean;
};

export type DunningAction =
  | { kind: "none" }
  | { kind: "remind"; reminderIndex: number; isFinalWarning: boolean }
  | { kind: "suspend" };

export function daysPastDue(dueDate: Date, now: Date): number {
  return Math.floor((now.getTime() - dueDate.getTime()) / 86_400_000);
}

/**
 * Decide what a past-due invoice's case needs today. Reminders fire in order
 * as their day thresholds pass (never twice); suspension fires once the grace
 * period is exhausted. Paused cases and already-suspended cases do nothing.
 */
export function decideDunningAction(
  policy: BillingPolicyLike,
  dunningCase: DunningCaseLike,
  pastDueDays: number,
): DunningAction {
  if (dunningCase.paused || dunningCase.suspendedAt) return { kind: "none" };
  if (pastDueDays < 0) return { kind: "none" };

  if (policy.autoSuspend && pastDueDays >= policy.graceDays) {
    return { kind: "suspend" };
  }

  const sorted = [...policy.reminderDays].sort((a, b) => a - b);
  const nextIndex = dunningCase.remindersSent;
  if (nextIndex < sorted.length && pastDueDays >= sorted[nextIndex]) {
    return {
      kind: "remind",
      reminderIndex: nextIndex,
      isFinalWarning: nextIndex === sorted.length - 1,
    };
  }
  return { kind: "none" };
}

/** An invoice is settled when recorded payments cover the amount due. */
export function isCovered(amountDueCents: number, paidCentsTotal: number): boolean {
  return paidCentsTotal >= amountDueCents;
}
