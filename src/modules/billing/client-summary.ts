/** Pure roll-up for one client's billing tiles. No DB, no Stripe. */

export type ClientBillingSummary = {
  liveCount: number;
  mrrCents: number;
  /** Open + failed invoices, net of partial payments. */
  outstandingCents: number;
  pastDueCount: number;
  lifetimePaidCents: number;
  /** The soonest renewal across live subscriptions. */
  nextCharge: {
    at: string;
    amountCents: number;
    subscriptionId: string;
    productName: string;
    autoCollects: boolean;
  } | null;
  /** Live subscriptions Stripe will only email a payment link for. */
  wontAutoCollect: { subscriptionId: string; productName: string; reason: string }[];
};

const CLOSED = new Set(["canceled", "expired"]);

export function summarizeClientBilling(input: {
  subscriptions: {
    id: string;
    productName: string;
    status: string;
    monthlyCents: number;
    currentPeriodEnd: string | null;
  }[];
  invoices: { status: string; amountDueCents: number; amountPaidCents: number; pastDue: boolean }[];
  automation: {
    subscriptionId: string;
    error: string | null;
    collectionMethod: "charge_automatically" | "send_invoice" | null;
    cardOnFile: boolean;
    nextChargeAt: string | null;
    monthlyCents: number;
  }[];
}): ClientBillingSummary {
  const auto = new Map(input.automation.map((a) => [a.subscriptionId, a]));
  const live = input.subscriptions.filter((s) => !CLOSED.has(s.status));

  const wontAutoCollect: ClientBillingSummary["wontAutoCollect"] = [];
  let nextCharge: ClientBillingSummary["nextCharge"] = null;
  for (const s of live) {
    const a = auto.get(s.id);
    const autoOk = Boolean(a && !a.error && a.collectionMethod === "charge_automatically" && a.cardOnFile);
    if (a && !a.error && !autoOk) {
      wontAutoCollect.push({
        subscriptionId: s.id,
        productName: s.productName,
        reason:
          a.collectionMethod === "charge_automatically"
            ? "auto-charge is on but there is no card on file"
            : a.cardOnFile
              ? "Stripe emails an invoice even though a card is on file"
              : "Stripe emails a payment link and no card is on file",
      });
    }
    const at = a?.nextChargeAt ?? s.currentPeriodEnd;
    if (at && (!nextCharge || at < nextCharge.at)) {
      nextCharge = {
        at,
        amountCents: a && !a.error && a.monthlyCents ? a.monthlyCents : s.monthlyCents,
        subscriptionId: s.id,
        productName: s.productName,
        autoCollects: autoOk,
      };
    }
  }

  const open = input.invoices.filter((i) => i.status === "open" || i.status === "failed");
  return {
    liveCount: live.length,
    mrrCents: live.reduce((sum, s) => sum + s.monthlyCents, 0),
    outstandingCents: open.reduce((sum, i) => sum + Math.max(0, i.amountDueCents - i.amountPaidCents), 0),
    pastDueCount: input.invoices.filter((i) => i.pastDue).length,
    lifetimePaidCents: input.invoices.reduce((sum, i) => sum + i.amountPaidCents, 0),
    nextCharge,
    wontAutoCollect,
  };
}
