/**
 * Form state for the negotiated-terms editor (Start subscription dialog and
 * the onboarding stepper) and its translation to `StartItemInput`. Client-safe.
 */
import { fromIsoDay } from "@/lib/dates";
import { toCents } from "@/lib/money";
import { isRecurringKind } from "./mappers";
import type { OfflinePaymentMethod } from "./payment-methods";
import type { StartComponent, StartItemInput } from "./start-logic";

export type TermComponent = StartComponent & { overrideCents: number | null };
export type TermSettlement = "invoice" | "offline" | "waive";

export type TermRow = {
  componentId: string;
  included: boolean;
  /** Dollars as typed. */
  price: string;
  quantity: number;
  settlement: TermSettlement;
  payment: { method: OfflinePaymentMethod; reference: string; receivedAt: string };
};

export const centsToInput = (cents: number) => (cents / 100).toFixed(2);

/** The main charge and required components start included; prices prefill from the client's override, else list. */
export function seedTermRows(components: TermComponent[], today: string): Record<string, TermRow> {
  return Object.fromEntries(
    components
      .filter((c) => c.isActive)
      .map((c) => [
        c.id,
        {
          componentId: c.id,
          included: c.role === "base" || c.isRequired,
          price: centsToInput(c.overrideCents ?? c.listCents),
          quantity: 1,
          settlement: "invoice" as const,
          payment: { method: "cash" as const, reference: "", receivedAt: today },
        },
      ]),
  );
}

/** Quantity is only editable on recurring add-ons. */
export const hasQuantity = (c: Pick<StartComponent, "kind" | "role">) => isRecurringKind(c.kind) && c.role !== "base";

export function isCustomPrice(c: TermComponent, r: TermRow): boolean {
  if (!isRecurringKind(c.kind) && r.settlement === "waive") return c.listCents !== 0;
  try {
    return toCents(r.price) !== c.listCents;
  } catch {
    return false;
  }
}

/** Included rows as action items; throws a readable error on a bad amount. */
export function rowsToItems(components: TermComponent[], rows: Record<string, TermRow>): StartItemInput[] {
  const out: StartItemInput[] = [];
  for (const c of components) {
    const r = rows[c.id];
    if (!r?.included) continue;
    const recurring = isRecurringKind(c.kind);
    let amountCents: number;
    if (!recurring && r.settlement === "waive") amountCents = 0;
    else {
      try {
        amountCents = toCents(r.price);
      } catch {
        throw new Error(`${c.name}: enter a valid amount`);
      }
    }
    const item: StartItemInput = { componentId: c.id, amountCents, quantity: hasQuantity(c) ? r.quantity : 1 };
    if (!recurring && r.settlement === "waive") item.settlement = { mode: "waive" };
    else if (!recurring && r.settlement === "offline") {
      item.settlement = {
        mode: "offline",
        payment: {
          method: r.payment.method,
          reference: r.payment.reference.trim() || undefined,
          receivedAt: r.payment.receivedAt ? fromIsoDay(r.payment.receivedAt) : undefined,
        },
      };
    }
    out.push(item);
  }
  return out;
}
