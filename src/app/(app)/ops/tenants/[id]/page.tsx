import { notFound, redirect } from "next/navigation";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getSession, isOps } from "@/policy";
import { db } from "@/db";
import { invoices } from "@/modules/billing/schema";
import { dunningStates, payments } from "@/modules/billing/ar-schema";
import { getTenant, listMembers } from "@/modules/tenancy/queries";
import { listTenantSubscriptions } from "@/modules/billing/queries";
import { OpsTenantBilling } from "@/modules/billing/components/ops-tenant-billing";
import { subscriptionProvisioning, provisioningCredentials } from "@/modules/provisioning/schema";
import { tenantTimeline } from "@/modules/audit/service";
import { OpsProvisioning } from "@/modules/provisioning/components/ops-provisioning";
import { listAllProductsOps } from "@/modules/catalog/queries";
import { tenantPriceOverrides } from "@/modules/billing/schema";
import { intervalLabel } from "@/modules/billing/mappers";
import { OpsCustomPricing } from "@/modules/billing/components/ops-custom-pricing";

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

  const subIds = subscriptions.map((s) => s.id);
  const [provRows, credRows, timeline] = await Promise.all([
    subIds.length
      ? db.query.subscriptionProvisioning.findMany({
          where: inArray(subscriptionProvisioning.subscriptionId, subIds),
        })
      : Promise.resolve([]),
    subIds.length
      ? db.query.provisioningCredentials.findMany({
          where: inArray(provisioningCredentials.subscriptionId, subIds),
        })
      : Promise.resolve([]),
    tenantTimeline(id),
  ]);

  const [allProducts, overrides] = await Promise.all([
    listAllProductsOps(),
    db.query.tenantPriceOverrides.findMany({
      where: eq(tenantPriceOverrides.tenantId, id),
    }),
  ]);
  const pricingRows = allProducts.flatMap((p) =>
    p.components.map((c) => ({
      componentId: c.id,
      productName: p.name,
      componentName: c.name,
      listCents: c.amountCents,
      intervalLabel: intervalLabel(c),
      overrideCents: overrides.find((o) => o.componentId === c.id)?.amountCents ?? null,
    })),
  );

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

  const provisioningItems = subscriptions
    .filter((s) => !["canceled", "expired"].includes(s.status))
    .map((s) => {
      const p = provRows.find((x) => x.subscriptionId === s.id);
      return {
        subscriptionId: s.id,
        productName: s.productName,
        domainUrl: p?.domainUrl ?? null,
        hasVerifyToken: Boolean(p?.verifyToken),
        verifyToken: p?.verifyToken ?? null,
        expectedCname: p?.expectedCname ?? null,
        expectedAIps: p?.expectedAIps ?? null,
        dnsLastOk: p?.dnsLastOk ?? null,
        dnsLastVerifiedAt: p?.dnsLastVerifiedAt?.toISOString() ?? null,
        dnsLastResolved: p?.dnsLastResolved ?? null,
        credentials: credRows
          .filter((c) => c.subscriptionId === s.id)
          .map((c) => ({
            id: c.id,
            kind: c.kind,
            label: c.label,
            url: c.url,
            username: c.username,
            hasSecret: Boolean(c.secretCiphertext),
          })),
      };
    });

  return (
    <div className="flex flex-col gap-8">
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
    <div className="mx-auto w-full max-w-5xl">
      <OpsCustomPricing tenantId={id} rows={pricingRows} />
    </div>
    <div className="mx-auto w-full max-w-5xl">
      <OpsProvisioning
        tenantId={id}
        items={provisioningItems}
        timeline={timeline.map((t) => ({
          id: t.id,
          kind: t.kind,
          actorName: t.actorName,
          createdAt: t.createdAt,
          payload: t.payload,
        }))}
      />
    </div>
    </div>
  );
}
