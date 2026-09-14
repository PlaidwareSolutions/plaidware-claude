import { requireOpsPage } from "@/policy";
import { listActiveProducts } from "@/modules/catalog/queries";
import { getContactSubmission } from "@/modules/contact/queries";
import { OnboardClientPage } from "@/modules/onboarding/components/onboard-client-page";
import { OPS } from "@/lib/routes";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Onboard a client" };
export const dynamic = "force-dynamic";

export default async function OnboardClientRoute({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  await requireOpsPage();
  const [{ lead: leadId }, products] = await Promise.all([searchParams, listActiveProducts()]);
  const lead = leadId ? await getContactSubmission(leadId) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: OPS.clients, label: "Clients" }}
        title="Onboard a client"
        description={
          lead
            ? `From the lead "${lead.name}${lead.company ? ` · ${lead.company}` : ""}" — it is marked contacted once the link exists.`
            : "Account, workspace, products at their negotiated prices, domains — the client gets one link to set a password and pay."
        }
      />
      <OnboardClientPage
        products={products}
        leadId={lead?.id ?? null}
        initial={lead ? { clientName: lead.name, clientEmail: lead.email, tenantName: lead.company ?? "" } : undefined}
      />
    </div>
  );
}
