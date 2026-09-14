"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BadgeDollarSign, ChevronDown, ChevronRight } from "lucide-react";
import type { PricingRow } from "../queries";
import { setTenantPriceOverrideAction } from "../ar-actions";
import { formatCents, toCents } from "@/lib/money";
import { OPS } from "@/lib/routes";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { Section } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ProductGroup = { productId: string; productName: string; rows: PricingRow[]; subscribed: boolean };

function groupRows(rows: PricingRow[], subscribedProductIds: string[]): ProductGroup[] {
  const subscribed = new Set(subscribedProductIds);
  const groups = new Map<string, ProductGroup>();
  for (const r of rows) {
    const g = groups.get(r.productId) ?? {
      productId: r.productId,
      productName: r.productName,
      rows: [],
      subscribed: subscribed.has(r.productId),
    };
    g.rows.push(r);
    groups.set(r.productId, g);
  }
  return [...groups.values()].sort(
    (a, b) => Number(b.subscribed) - Number(a.subscribed) || a.productName.localeCompare(b.productName),
  );
}

/** Per-tenant negotiated prices (billing v2). Applies to future checkouts and
 *  add-on purchases; existing subscriptions keep their locked-in prices. */
export function OpsCustomPricing({
  tenantId,
  rows,
  subscribedProductIds,
}: {
  tenantId: string;
  rows: PricingRow[];
  subscribedProductIds: string[];
}) {
  const { run, isPending } = useAction();
  const confirm = useConfirm();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showOthers, setShowOthers] = useState(false);

  const groups = groupRows(rows, subscribedProductIds);
  const subscribedGroups = groups.filter((g) => g.subscribed);
  const otherGroups = groups.filter((g) => !g.subscribed);
  const overridesElsewhere = otherGroups.reduce(
    (n, g) => n + g.rows.filter((r) => r.overrideCents != null).length,
    0,
  );

  async function save(group: ProductGroup, row: PricingRow, value: string) {
    let cents: number | null = null;
    try {
      cents = value.trim() ? toCents(value) : null;
    } catch {
      toast.error("Enter a valid amount, or clear to return to list price");
      return;
    }
    if (!group.subscribed && cents != null) {
      const ok = await confirm({
        title: `Price ${group.productName} for this client?`,
        description: `They are not subscribed to ${group.productName}. The custom price only applies if they buy it later — check you meant this product and not one they already have.`,
        confirmLabel: "Save price",
      });
      if (!ok) return;
    }
    const res = await run(
      () => setTenantPriceOverrideAction({ tenantId, componentId: row.componentId, amountCents: cents }),
      {
        key: row.componentId,
        success:
          cents != null
            ? `${group.productName} · ${row.componentName}: ${formatCents(cents)}${row.intervalLabel} for this client`
            : `${group.productName} · ${row.componentName}: back to list price`,
      },
    );
    if (res?.ok) {
      setDrafts((d) => {
        const { [row.componentId]: _drop, ...rest } = d;
        return rest;
      });
    }
  }

  const renderGroup = (group: ProductGroup) => (
    <div key={group.productId} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-sm">
        <Link href={OPS.product(group.productId)} className="font-medium text-heading hover:text-primary">
          {group.productName}
        </Link>
        {group.subscribed ? (
          <Badge variant="success" className="text-[10px]">subscribed</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">not subscribed</Badge>
        )}
      </div>
      {group.rows.map((row) => {
        const draft = drafts[row.componentId];
        const current = row.overrideCents != null ? (row.overrideCents / 100).toFixed(2) : "";
        const shown = draft ?? current;
        const dirty = draft != null && draft.trim() !== current;
        return (
          <div key={row.componentId} className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
            <div className="min-w-56 flex-1">
              <span className="text-heading">{row.componentName}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                list {formatCents(row.listCents)}{row.intervalLabel}
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
              disabled={isPending(row.componentId) || !dirty}
              onClick={() => save(group, row, draft ?? "")}
            >
              {isPending(row.componentId) ? "…" : "Save"}
            </Button>
          </div>
        );
      })}
    </div>
  );

  return (
    <Section
      title="Custom pricing"
      icon={BadgeDollarSign}
      description="Used at the client's next checkout or add-on purchase; existing subscriptions keep their locked-in prices. Clear a field to return to list."
    >
      <div className="flex flex-col gap-4">
        {subscribedGroups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No live subscriptions — prices set here apply when the client buys a product.
          </p>
        )}
        {subscribedGroups.map(renderGroup)}
        {otherGroups.length > 0 && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setShowOthers((v) => !v)}
              className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-heading"
            >
              {showOthers ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              Other products ({otherGroups.length})
              {overridesElsewhere > 0 && (
                <Badge variant="warning" className="ml-1 text-[10px]">
                  {overridesElsewhere} custom price{overridesElsewhere === 1 ? "" : "s"}
                </Badge>
              )}
            </button>
            {showOthers && otherGroups.map(renderGroup)}
          </div>
        )}
      </div>
    </Section>
  );
}
