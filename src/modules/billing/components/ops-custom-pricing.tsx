"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeDollarSign } from "lucide-react";
import { setTenantPriceOverrideAction } from "../ar-actions";
import { intervalLabel } from "../mappers";
import { formatCents, toCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type PricingRow = {
  componentId: string;
  productName: string;
  name: string;
  kind: string;
  interval: string | null;
  intervalCount: number;
  listCents: number;
  overrideCents: number | null;
};

/** Per-tenant negotiated prices (billing v2). Ops-only. */
export function OpsCustomPricing({ tenantId, rows }: { tenantId: string; rows: PricingRow[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function save(row: PricingRow, raw: string) {
    setBusy(row.componentId);
    try {
      const cents = raw.trim() === "" ? null : toCents(raw);
      const res = await setTenantPriceOverrideAction({
        tenantId,
        componentId: row.componentId,
        amountCents: cents,
      });
      if (res.ok) {
        toast.success(
          cents == null || cents === 0
            ? `${row.name}: back to list price`
            : `${row.name}: custom price ${formatCents(cents)} — applies to future checkouts and add-ons`,
        );
        setDrafts((d) => {
          const { [row.componentId]: _drop, ...rest } = d;
          void _drop;
          return rest;
        });
        router.refresh();
      } else toast.error(res.error);
    } catch {
      toast.error("Enter a valid amount (blank clears)");
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BadgeDollarSign className="size-4 text-primary" /> Custom pricing
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Negotiated prices for this tenant. Existing subscriptions keep their
          purchased prices; overrides apply to future checkouts and add-ons.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const draft = drafts[row.componentId];
          const shown = draft ?? (row.overrideCents != null ? (row.overrideCents / 100).toFixed(2) : "");
          return (
            <div key={row.componentId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-heading">{row.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {row.productName} · list {formatCents(row.listCents)}
                  {row.kind === "one_time" ? " once" : intervalLabel(row)}
                </span>
                {row.overrideCents != null && (
                  <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    CUSTOM
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 w-28 text-right text-xs tabular-nums"
                  placeholder={(row.listCents / 100).toFixed(2)}
                  value={shown}
                  onChange={(e) => setDrafts({ ...drafts, [row.componentId]: e.target.value })}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === row.componentId || draft === undefined}
                  onClick={() => save(row, draft ?? "")}
                >
                  {busy === row.componentId ? "…" : "Save"}
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
