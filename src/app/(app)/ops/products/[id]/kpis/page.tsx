import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { METRIC_DEFS } from "@/modules/catalog/seed";
import { MetricDefinitionsPanel } from "@/modules/monitoring/components/metric-definitions-panel";
import { loadProduct, productMetadata } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return productMetadata(params, "KPIs");
}

export default async function ProductKpisPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOpsPage("support");
  const { id } = await params;
  const data = await loadProduct(id);
  if (!data) notFound();
  return (
    <MetricDefinitionsPanel
      productId={id}
      productSlug={data.product.slug}
      definitions={data.metricDefinitions}
      templates={Object.keys(METRIC_DEFS)}
      reporterQuietAfterMinutes={data.product.reporterQuietAfterMinutes}
    />
  );
}
