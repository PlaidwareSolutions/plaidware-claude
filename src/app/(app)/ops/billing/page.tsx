import { requireOpsPage } from "@/policy";
import { env } from "@/env";
import { stripeConfigured, stripeTestMode } from "@/lib/stripe";
import { listAllTenants, listTenantOwnerEmails } from "@/modules/tenancy/queries";
import {
  getBillingAutomationStatus,
  getPlatformBillingStats,
  listAllInvoicesOps,
  listAllSubscriptionsOps,
} from "@/modules/billing/queries";
import { getBillingPolicy } from "@/modules/billing/ar-service";
import { BILLING_SCHEDULE, nextDailyRunUtc, nextMonthlyRunUtc } from "@/modules/billing/schedule";
import { OpsBillingBoard } from "@/modules/billing/components/ops-billing-board";

export const metadata = { title: "Board · Billing" };
export const dynamic = "force-dynamic";

export default async function OpsBillingPage() {
  await requireOpsPage("support");

  const [tenants, owners, subscriptions, invoices, stats, automation, policy] = await Promise.all([
    listAllTenants(),
    listTenantOwnerEmails(),
    listAllSubscriptionsOps(),
    listAllInvoicesOps(),
    getPlatformBillingStats(),
    getBillingAutomationStatus(), // live Stripe reads — never cached
    getBillingPolicy(),
  ]);

  const now = new Date();
  return (
    <OpsBillingBoard
      generatedAt={now.toISOString()}
      config={{
        stripe: stripeConfigured(),
        webhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
        email: Boolean(env.RESEND_API_KEY),
        testMode: stripeTestMode(),
      }}
      stats={stats}
      tenants={tenants.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        memberCount: t.memberCount,
        stripeCustomerId: t.stripeCustomerId,
        ownerEmail: owners[t.id] ?? null,
      }))}
      subscriptions={subscriptions}
      automation={automation}
      invoices={invoices}
      policy={{
        reminderDays: policy.reminderDays,
        graceDays: policy.graceDays,
        autoSuspend: policy.autoSuspend,
        upcomingReminderDays: policy.upcomingReminderDays,
      }}
      schedule={{
        dunningNextUtc: nextDailyRunUtc(BILLING_SCHEDULE.dunningSweep.hourUtc, now).toISOString(),
        hostingNextUtc: nextMonthlyRunUtc(
          BILLING_SCHEDULE.hostingInvoices.dayOfMonth,
          BILLING_SCHEDULE.hostingInvoices.hourUtc,
          now,
        ).toISOString(),
      }}
    />
  );
}
