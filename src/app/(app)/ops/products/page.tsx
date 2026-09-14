import Link from "next/link";
import { Package } from "lucide-react";
import { requireOpsPage } from "@/policy";
import { OPS, withQuery } from "@/lib/routes";
import { listAllProductsOps } from "@/modules/catalog/queries";
import { formatCents } from "@/lib/money";
import { NewProductDialog } from "@/modules/catalog/components/new-product-dialog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Products" };
export const dynamic = "force-dynamic";

export default async function OpsProductsPage() {
  await requireOpsPage();

  const products = await listAllProductsOps();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Products"
        description="The catalog: what each product bills, and what clients see on the marketing site."
        actions={<NewProductDialog />}
      />
      <DataTableShell footer={`${products.length} product${products.length === 1 ? "" : "s"} · hidden products stay out of the catalog but keep billing existing subscribers.`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="hidden sm:table-cell">Components</TableHead>
              <TableHead className="hidden md:table-cell">Monthly from</TableHead>
              <TableHead className="hidden lg:table-cell" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 && (
              <TableEmpty
                colSpan={5}
                icon={Package}
                title="No products yet"
                description="Create a product, add its pricing components, then make it visible."
              />
            )}
            {products.map((p) => {
              const monthly = p.components.find((c) => c.role === "base") ?? p.components[0];
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={OPS.product(p.id)} className="flex items-center gap-2 font-medium text-heading hover:text-primary">
                      <span className="size-2 rounded-full" style={{ background: p.color ?? "var(--primary)" }} />
                      {p.name}
                    </Link>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {p.slug}
                      {!p.isActive && <StatusBadge kind="product" status="hidden" className="text-[9px]" />}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{p.category}</Badge>
                  </TableCell>
                  <TableCell className="hidden tabular-nums sm:table-cell">
                    {p.components.length}
                  </TableCell>
                  <TableCell className="hidden tabular-nums md:table-cell">
                    {monthly ? formatCents(monthly.amountCents) : "—"}
                  </TableCell>
                  <TableCell className="hidden text-right lg:table-cell">
                    <Link
                      href={withQuery(OPS.subscriptions, { product: p.slug })}
                      className="text-xs text-muted-foreground hover:text-primary"
                    >
                      Subscribers →
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTableShell>
    </div>
  );
}
