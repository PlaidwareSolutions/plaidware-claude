import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { MARKETING, OPS, withQuery } from "@/lib/routes";
import { formatCents } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { ProductTabs } from "@/modules/catalog/components/product-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { loadProduct } from "./load";

export default async function ProductLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireOpsPage();
  const { id } = await params;
  const data = await loadProduct(id);
  if (!data) notFound();
  const p = data.product;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: OPS.products, label: "Products" }}
        title={
          <span className="inline-flex items-center gap-2">
            <span className="size-3 rounded-full" style={{ background: p.color ?? "var(--primary)" }} />
            {p.name}
          </span>
        }
        badge={
          <>
            <StatusBadge kind="product" status={p.isActive ? "active" : "hidden"} />
            {p.isMarketing && <Badge variant="outline" title="Billed here, run by the Marketing Ops Hub">MHub</Badge>}
          </>
        }
        meta={
          <>
            /{p.slug} · {p.category} · {data.liveSubscribers} live subscriber{data.liveSubscribers === 1 ? "" : "s"} ·{" "}
            {formatCents(data.mrrCents)} MRR
          </>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={withQuery(OPS.monitoring, { product: p.slug })}>Monitoring</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={OPS.costs}>Costs</Link>
            </Button>
            {p.isActive && (
              <Button asChild variant="outline" size="sm">
                <a href={MARKETING.product(p.slug)} target="_blank" rel="noreferrer">Public page</a>
              </Button>
            )}
          </>
        }
      >
        <ProductTabs
          id={p.id}
          isMarketing={p.isMarketing}
          counts={{
            components: data.components.filter((c) => c.isActive).length,
            kpis: data.metricDefinitions.length,
            subscribers: data.liveSubscribers,
          }}
        />
      </PageHeader>
      {children}
    </div>
  );
}
