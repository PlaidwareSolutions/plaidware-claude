import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import {
  getBillingAutomationStatus,
  getStartSubscriptionOptions,
  listAddonOptions,
  listAllInvoicesOps,
  listTenantPricingRows,
  listTenantSubscriptions,
} from "@/modules/billing/queries";
import { getBillingPolicy } from "@/modules/billing/ar-service";
import { listPendingSetupTerms } from "@/modules/onboarding/queries";
import { BILLING_SCHEDULE, nextDailyRunUtc } from "@/modules/billing/schedule";
import { OpsClientBilling } from "@/modules/billing/components/ops-client-billing";
import { stripeTestMode } from "@/lib/stripe";
import { loadClient, clientMetadata } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return clientMetadata(params, "Billing");
}

export default async function ClientBillingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOpsPage("support");
  const { id } = await params;
  const client = await loadClient(id);
  if (!client) notFound();

  const [subscriptions, invoices, automation, pricingRows, policy, startable, pendingSetups] = await Promise.all([
    listTenantSubscriptions(id),
    listAllInvoicesOps(200, { tenantId: id }),
    getBillingAutomationStatus({ tenantId: id }), // live Stripe reads — never cached
    listTenantPricingRows(id),
    getBillingPolicy(),
    getStartSubscriptionOptions(id), // one live Stripe read for the card-on-file flag
    listPendingSetupTerms(id),
  ]);
  const addonOptions = await listAddonOptions(id, subscriptions);

  return (
    <OpsClientBilling
      tenant={{ id: client.id, name: client.name }}
      subscriptions={subscriptions}
      automation={automation}
      addonOptions={addonOptions}
      invoices={invoices}
      pricingRows={pricingRows}
      policy={{
        reminderDays: policy.reminderDays,
        graceDays: policy.graceDays,
        autoSuspend: policy.autoSuspend,
        upcomingReminderDays: policy.upcomingReminderDays,
      }}
      nextSweepUtc={nextDailyRunUtc(BILLING_SCHEDULE.dunningSweep.hourUtc).toISOString()}
      stripeTestMode={stripeTestMode()}
      startable={startable}
      pendingSetups={pendingSetups}
    />
  );
}
