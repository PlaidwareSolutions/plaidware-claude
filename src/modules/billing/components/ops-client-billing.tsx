"use client";

import { useState } from "react";
import { CreditCard, FilePlus2, Receipt, Timer } from "lucide-react";
import type { AddonOption, OpsInvoiceDto, PricingRow, SubscriptionAutomation, SubscriptionDto } from "../queries";
import { formatUtcHour } from "@/lib/dates";
import { Section } from "@/components/section";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { useOpsAccess } from "@/components/ops-access";
import { NewInvoiceDialog, type TenantTarget } from "./ops-billing-dialogs";
import { SubscriptionCard } from "./subscription-card";
import { InvoicesTable } from "./invoices-table";
import { OpsCustomPricing } from "./ops-custom-pricing";
import { BillingPolicyEditor, policySummary, type BillingPolicyDto } from "./billing-policy-editor";

export function OpsClientBilling({
  tenant,
  subscriptions,
  automation,
  addonOptions,
  invoices,
  pricingRows,
  policy,
  nextSweepUtc,
  stripeTestMode,
}: {
  tenant: { id: string; name: string };
  subscriptions: SubscriptionDto[];
  automation: SubscriptionAutomation[];
  addonOptions: Record<string, AddonOption[]>;
  invoices: OpsInvoiceDto[];
  pricingRows: PricingRow[];
  policy: BillingPolicyDto;
  nextSweepUtc: string;
  stripeTestMode: boolean;
}) {
  const [invoiceFor, setInvoiceFor] = useState<TenantTarget | null>(null);
  const { canMutate } = useOpsAccess();
  const autoById = new Map(automation.map((a) => [a.subscriptionId, a]));
  const open = subscriptions.filter((s) => !["canceled", "expired"].includes(s.status));
  const closed = subscriptions.filter((s) => ["canceled", "expired"].includes(s.status));
  const pastDue = invoices.filter((i) => i.pastDue).length;

  return (
    <div className="flex flex-col gap-8">
      <Section title="Subscriptions" icon={CreditCard} count={open.length}>
        {subscriptions.length === 0 ? (
          <EmptyState icon={CreditCard} title="No subscriptions" description="Products appear here once the client completes a setup link or checkout." />
        ) : (
          <div className="flex flex-col gap-3">
            {open.map((s) => (
              <SubscriptionCard
                key={s.id}
                tenant={tenant}
                sub={s}
                automation={autoById.get(s.id)}
                addonOptions={addonOptions[s.id] ?? []}
                stripeTestMode={stripeTestMode}
              />
            ))}
            {closed.length > 0 && (
              <details className="rounded-lg border bg-card px-4 py-2 text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  {closed.length} closed subscription{closed.length === 1 ? "" : "s"}
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  {closed.map((s) => (
                    <SubscriptionCard key={s.id} tenant={tenant} sub={s} automation={undefined} addonOptions={[]} stripeTestMode={stripeTestMode} />
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Invoices & payments"
        icon={Receipt}
        count={invoices.length}
        description={pastDue > 0 ? `${pastDue} past due — dunning handles reminders and suspension` : undefined}
        actions={
          canMutate ? (
            <Button size="sm" className="gap-2" onClick={() => setInvoiceFor({ id: tenant.id, name: tenant.name })}>
              <FilePlus2 className="size-4" /> New invoice
            </Button>
          ) : undefined
        }
      >
        <InvoicesTable invoices={invoices} />
      </Section>

      {canMutate && (
        <OpsCustomPricing tenantId={tenant.id} rows={pricingRows} subscribedProductIds={open.map((s) => s.productId)} />
      )}

      <Section
        title="Dunning & policy"
        icon={Timer}
        description={`Next sweep ${formatUtcHour(nextSweepUtc)}`}
        actions={canMutate ? <BillingPolicyEditor policy={policy} /> : undefined}
        card
      >
        <p className="text-sm text-muted-foreground">
          Platform-wide: {policySummary(policy)}. Pause dunning on an individual invoice from the table above; a
          manual subscription hold is set from the subscription&apos;s menu.
        </p>
      </Section>

      <NewInvoiceDialog key={invoiceFor?.id ?? "none"} target={invoiceFor} onOpenChange={(o) => !o && setInvoiceFor(null)} />
    </div>
  );
}
