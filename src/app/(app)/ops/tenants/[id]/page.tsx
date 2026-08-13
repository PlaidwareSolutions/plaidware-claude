import { notFound, redirect } from "next/navigation";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getSession, isOps } from "@/policy";
import { db } from "@/db";
import { invoices } from "@/modules/billing/schema";
import { dunningStates, payments } from "@/modules/billing/ar-schema";
import { getTenant, listMembers } from "@/modules/tenancy/queries";
import { listTenantSubscriptions } from "@/modules/billing/queries";
import { OpsTenantBilling } from "@/modules/billing/components/ops-tenant-billing";

export const metadata = { title: "Tenant" };
export const dynamic = "force-dynamic";

export default async function OpsTenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOps(session)) redirect("/dashboard");

  const { id } = await params;
  const tenant = await getTenant(id);
  if (!tenant) notFound();

  const [members, subscriptions, tenantInvoices] = await Promise.all([
    listMembers(id),
    listTenantSubscriptions(id),
    db.query.invoices.findMany({
      where: eq(invoices.tenantId, id),
      orderBy: [desc(invoices.createdAt)],
      limit: 100,
    }),
  ]);

  const invoiceIds = tenantInvoices.map((i) => i.id);
  const [cases, paymentRows] = await Promise.all([
    invoiceIds.length
      ? db.query.dunningStates.findMany({
          where: and(inArray(dunningStates.invoiceId, invoiceIds), isNull(dunningStates.resolvedAt)),
        })
      : Promise.resolve([]),
    invoiceIds.length
      ? db.query.payments.findMany({ where: inArray(payments.invoiceId, invoiceIds) })
      : Promise.resolve([]),
  ]);

  return (
    <OpsTenantBilling
      tenant={{
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug ?? "",
        status: tenant.status ?? "active",
        memberCount: members.length,
      }}
      subscriptions={subscriptions}
      invoices={tenantInvoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        kind: inv.kind,
        status: inv.status,
        amountDueCents: inv.amountDueCents,
        amountPaidCents: inv.amountPaidCents,
        hostedInvoiceUrl: inv.hostedInvoiceUrl,
        dueDate: inv.dueDate?.toISOString() ?? null,
        createdAt: inv.createdAt.toISOString(),
        dunning: (() => {
          const c = cases.find((x) => x.invoiceId === inv.id);
          return c
            ? {
                id: c.id,
                remindersSent: c.remindersSent,
                suspendedAt: c.suspendedAt?.toISOString() ?? null,
                paused: c.paused,
              }
            : null;
        })(),
        payments: paymentRows
          .filter((p) => p.invoiceId === inv.id)
          .map((p) => ({
            id: p.id,
            amountCents: p.amountCents,
            method: p.method,
            reference: p.reference,
            receivedAt: p.receivedAt.toISOString(),
          })),
      }))}
    />
  );
}
