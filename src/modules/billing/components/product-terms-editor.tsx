"use client";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCents, toCents } from "@/lib/money";
import { isoDay } from "@/lib/dates";
import { intervalLabel, isRecurringKind } from "../mappers";
import { OFFLINE_PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type OfflinePaymentMethod } from "../payment-methods";
import { hasQuantity, isCustomPrice, type TermComponent, type TermRow, type TermSettlement } from "../start-form";

const cadence = (c: { kind: string; interval?: string | null; intervalCount?: number | null }) =>
  isRecurringKind(c.kind) ? intervalLabel(c) : "one-time";

/**
 * The negotiated-terms rows shared by the ops Start-subscription dialog and
 * the onboarding stepper: include, unit price, quantity (recurring add-ons
 * only) and how a one-time item settles — charged, already paid offline, or
 * waived. State lives in the caller (`seedTermRows` / `rowsToItems`).
 */
export function ProductTermsEditor({
  mode,
  components,
  rows,
  onChange,
}: {
  /** Changes the wording of the "charge" settlement option. */
  mode: "start" | "setup_link";
  components: TermComponent[];
  rows: Record<string, TermRow>;
  onChange: (rows: Record<string, TermRow>) => void;
}) {
  const today = isoDay();
  const update = (id: string, patch: Partial<TermRow>) => onChange({ ...rows, [id]: { ...rows[id], ...patch } });

  return (
    <div className="grid gap-2">
      {components
        .filter((c) => c.isActive)
        .map((c) => {
          const r = rows[c.id];
          if (!r) return null;
          const locked = c.role === "base" || c.isRequired;
          const recurring = isRecurringKind(c.kind);
          const waived = !recurring && r.settlement === "waive";
          const custom = r.included && isCustomPrice(c, r);
          const withQty = hasQuantity(c);
          let unit = 0;
          try {
            unit = toCents(r.price);
          } catch {
            unit = 0;
          }
          return (
            <div key={c.id} className="rounded-md border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Checkbox
                  checked={r.included}
                  disabled={locked}
                  aria-label={`Include ${c.name}`}
                  onCheckedChange={(v) => update(c.id, { included: Boolean(v) })}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-heading">
                    {c.name}
                    {c.role === "base" && <span className="ml-1.5 text-[10px] uppercase text-coral">main</span>}
                    {c.role !== "base" && c.isRequired && (
                      <Badge variant="outline" className="ml-1.5 text-[10px]">required</Badge>
                    )}
                    {custom && <Badge variant="warning" className="ml-1.5 text-[10px]">custom</Badge>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    list {formatCents(c.listCents)} {cadence(c)}
                    {c.overrideCents != null && (
                      <>
                        {" · "}
                        <span className="font-semibold text-primary">custom {formatCents(c.overrideCents)} {cadence(c)}</span>
                      </>
                    )}
                    {withQty && r.included && r.quantity > 1 && unit > 0 && <> · = {formatCents(unit * r.quantity)}{cadence(c)}</>}
                  </div>
                </div>
                {withQty && (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">×</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={99}
                      step={1}
                      className="h-8 w-16 text-right text-sm"
                      aria-label={`${c.name} quantity`}
                      value={r.quantity}
                      onChange={(e) =>
                        update(c.id, {
                          quantity: Math.max(1, Math.min(99, Math.floor(Number(e.target.value) || 1))),
                          included: true,
                        })
                      }
                    />
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">$</span>
                  <Input
                    className="h-8 w-24 text-right text-sm"
                    aria-label={`${c.name} unit price`}
                    value={waived ? "0.00" : r.price}
                    disabled={waived}
                    onChange={(e) =>
                      // Typing a price for an unticked item includes it — nobody prices what they're not selling.
                      update(c.id, { price: e.target.value, included: r.included || locked || e.target.value.trim() !== "" })
                    }
                  />
                  <span className="w-16 text-[11px] text-muted-foreground">
                    {withQty ? "ea " : ""}
                    {cadence(c)}
                  </span>
                </div>
                {!recurring && r.included && (
                  <Select value={r.settlement} onValueChange={(v) => update(c.id, { settlement: v as TermSettlement })}>
                    <SelectTrigger className="h-8 w-48 text-xs" aria-label={`${c.name} settlement`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="invoice">
                        {mode === "setup_link" ? "Client pays on the link" : "Charge on first invoice"}
                      </SelectItem>
                      <SelectItem value="offline">Already paid offline</SelectItem>
                      <SelectItem value="waive">Waive ($0)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
              {!recurring && r.included && r.settlement === "offline" && (
                <div className="mt-2 grid gap-2 border-t pt-2 sm:grid-cols-3">
                  <div className="grid gap-1">
                    <Label className="text-xs">Method</Label>
                    <Select
                      value={r.payment.method}
                      onValueChange={(v) => update(c.id, { payment: { ...r.payment, method: v as OfflinePaymentMethod } })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OFFLINE_PAYMENT_METHODS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {PAYMENT_METHOD_LABEL[m]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">Reference</Label>
                    <Input
                      className="h-8 text-sm"
                      placeholder="receipt #, check #…"
                      value={r.payment.reference}
                      onChange={(e) => update(c.id, { payment: { ...r.payment, reference: e.target.value } })}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">Received on</Label>
                    <Input
                      type="date"
                      className="h-8 text-sm"
                      max={today}
                      value={r.payment.receivedAt}
                      onChange={(e) => update(c.id, { payment: { ...r.payment, receivedAt: e.target.value } })}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
