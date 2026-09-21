"use client";

import { useState } from "react";
import type { AddonOption, SubscriptionDto } from "../queries";
import { opsChangeSubscriptionItemsAction } from "../ar-actions";
import { intervalLabel, isRecurringKind } from "../mappers";
import { formatCents } from "@/lib/money";
import { useAction } from "@/lib/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const cadence = (c: { kind: string; interval?: string | null; intervalCount?: number | null }) =>
  isRecurringKind(c.kind) ? intervalLabel(c) : "one-time";

/**
 * Ops-side add-on changes on a live subscription. Recurring additions (with a
 * quantity) and removals prorate on the next invoice; one-time additions
 * invoice + charge now.
 */
export function ManageAddonsDialog({
  subscription,
  options,
  open,
  onOpenChange,
}: {
  subscription: SubscriptionDto;
  options: AddonOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { run, pending } = useAction();
  /** componentId → quantity to add. */
  const [add, setAdd] = useState<Map<string, number>>(new Map());
  const [remove, setRemove] = useState<Set<string>>(new Set());

  const removable = subscription.items.filter((i) => i.status === "active" && isRecurringKind(i.kind));
  const addTotal = options.filter((o) => add.has(o.id)).reduce((s, o) => s + o.amountCents * (add.get(o.id) ?? 1), 0);
  const oneTimeNow = options
    .filter((o) => add.has(o.id) && !isRecurringKind(o.kind))
    .reduce((s, o) => s + o.amountCents, 0);

  async function apply() {
    const res = await run(
      () =>
        opsChangeSubscriptionItemsAction({
          subscriptionId: subscription.id,
          addItems: [...add].map(([componentId, quantity]) => ({ componentId, quantity })),
          removeItemIds: [...remove],
        }),
      {
        key: "addons",
        success: (r) => `${subscription.productName}: ${r.added} added, ${r.removed} removed`,
      },
    );
    if (res?.ok) {
      setAdd(new Map());
      setRemove(new Set());
      onOpenChange(false);
    }
  }

  const toggleAdd = (id: string, on: boolean) => {
    const next = new Map(add);
    if (on) next.set(id, next.get(id) ?? 1);
    else next.delete(id);
    setAdd(next);
  };
  const setQty = (id: string, q: number) => {
    const next = new Map(add);
    next.set(id, Math.max(1, Math.min(99, Math.floor(q) || 1)));
    setAdd(next);
  };
  const toggleRemove = (id: string, on: boolean) => {
    const next = new Set(remove);
    if (on) next.add(id);
    else next.delete(id);
    setRemove(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add-ons — {subscription.productName}</DialogTitle>
          <DialogDescription>
            Recurring changes prorate on the next invoice. One-time add-ons are invoiced and charged to the card on
            file immediately (emailed when the subscription is invoice-collected).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add</div>
            {options.length === 0 && <p className="text-sm text-muted-foreground">Every add-on for this product is already on the subscription.</p>}
            {options.map((o) => {
              const on = add.has(o.id);
              const qty = add.get(o.id) ?? 1;
              return (
                <label key={o.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Checkbox checked={on} onCheckedChange={(v) => toggleAdd(o.id, Boolean(v))} />
                  <span className="flex-1 text-heading">{o.name}</span>
                  {on && isRecurringKind(o.kind) && (
                    <span className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">×</span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={99}
                        className="h-7 w-14 text-right text-xs"
                        aria-label={`${o.name} quantity`}
                        value={qty}
                        onChange={(e) => setQty(o.id, Number(e.target.value))}
                      />
                    </span>
                  )}
                  <span className="tabular-nums text-muted-foreground">
                    {formatCents(o.amountCents)} <span className="text-xs">{cadence(o)}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Remove</div>
            {removable.length === 0 && <p className="text-sm text-muted-foreground">No optional recurring items to remove.</p>}
            {removable.map((i) => (
              <label key={i.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Checkbox checked={remove.has(i.id)} onCheckedChange={(v) => toggleRemove(i.id, Boolean(v))} />
                <span className="flex-1 text-heading">
                  {i.name}
                  {i.quantity > 1 && <span className="ml-1 text-xs text-muted-foreground">×{i.quantity}</span>}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {i.quantity > 1 ? `${formatCents(i.amountCents)} ea · ${formatCents(i.amountCents * i.quantity)}` : formatCents(i.amountCents)}{" "}
                  <span className="text-xs">{cadence(i)}</span>
                </span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">The main charge can&apos;t be removed — cancel the subscription instead.</p>
          </div>
          {(add.size > 0 || remove.size > 0) && (
            <p className="text-sm text-heading">
              {add.size > 0 && <>Adding {formatCents(addTotal)}{oneTimeNow > 0 && <> ({formatCents(oneTimeNow)} charged now)</>}</>}
              {add.size > 0 && remove.size > 0 && " · "}
              {remove.size > 0 && <>Removing {remove.size} item{remove.size === 1 ? "" : "s"}</>}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={apply} disabled={pending || (add.size === 0 && remove.size === 0)}>
            {pending ? "Applying…" : "Apply changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
