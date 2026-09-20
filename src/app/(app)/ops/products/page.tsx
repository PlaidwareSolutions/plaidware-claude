import { requireOpsPage } from "@/policy";
import { listProductsBoardOps } from "@/modules/catalog/queries";
import { NewProductDialog } from "@/modules/catalog/components/new-product-dialog";
import { ProductsBoard } from "@/modules/catalog/components/products-board";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Products" };
export const dynamic = "force-dynamic";

export default async function OpsProductsPage() {
  await requireOpsPage("support");
  const rows = await listProductsBoardOps();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Products"
        description="What each product bills, who subscribes, whether it is healthy, and what it costs to run."
        actions={<NewProductDialog />}
      />
      <ProductsBoard rows={rows} />
    </div>
  );
}
