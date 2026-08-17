"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeDollarSign } from "lucide-react";
import { setTenantPriceOverrideAction } from "../ar-actions";
import { formatCents, toCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type PricingRow = {
  componentId: string;
  productName: string;
  componentName: string;
  listCents: number;
  intervalLabel: string;
  overrideCents: number | null;
};

/** Per-tenant negotiated prices (billing v2). Applies to future checkouts and
 *  add-on purchases; existing subscriptions keep their locked-in prices. */
export function OpsCustomPricing({ tenantId, rows }: { tenantId: string; rows: PricingRow[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function save(row: PricingRow, value: string) {
    setBusy(row.componentId);
    let cents: number | null = null;
    try {
      cents = value.trim() ? toCents(value) : null;
    } catch {
      setBusy(null);
      toast.error("Enter a valid amount, or clear to return to list price");
      return;
    }
    const res = await setTenantPriceOverrideAction({
      tenantId,
      componentId: row.componentId,
      amountCents: cents,
    });
    setBusy(null);
    if (res.ok) {
      toast.success(
        cents
          ? `${row.componentName}: ${formatCents(cents)}${row.intervalLabel} for this customer`
          : `${row.componentName}: back to list price`,
      );
      setDrafts((d) => {
        const { [row.componentId]: _drop, ...rest } = d;
        return rest;
      });
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BadgeDollarSign className="size-4 text-primary" /> Custom pricing
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Negotiated prices for this customer — used at their next checkout or
          add-on purchase. Existing subscriptions keep their locked-in prices.
          Clear a field to return to list.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const draft = drafts[row.componentId];
          const shown =
            draft ?? (row.overrideCents != null ? (row.overrideCents / 100).toFixed(2) : "");
          const dirty =
            draft != null &&
            draft.trim() !== (row.overrideCents != null ? (row.overrideCents / 100).toFixed(2) : "");
          return (
            <div key={row.componentId} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <div className="min-w-56 flex-1">
                <span className="font-medium text-heading">{row.componentName}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {row.productName} · list {formatCents(row.listCents)}{row.intervalLabel}
                </span>
                {row.overrideCents != null && (
                  <span className="ml-2 text-xs font-semibold text-primary">
                    custom {formatCents(row.overrideCents)}{row.intervalLabel}
                  </span>
                )}
              </div>
              <Input
                className="h-8 w-28 text-right text-xs tabular-nums"
                placeholder="list"
                value={shown}
                onChange={(e) => setDrafts({ ...drafts, [row.componentId]: e.target.value })}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={busy === row.componentId || !dirty}
                onClick={() => save(row, draft ?? "")}
              >
                {busy === row.componentId ? "…" : "Save"}
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
