import { redirect } from "next/navigation";
import { getSession, isOps } from "@/policy";
import { listActiveProducts } from "@/modules/catalog/queries";
import { formatCents } from "@/lib/money";
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

export default async function OpsProductsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOps(session)) redirect("/dashboard");

  const products = await listActiveProducts();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-heading">Products</h1>
        <p className="text-sm text-muted-foreground">
          The catalog as customers see it. Editing and Stripe price sync arrive
          in M3.
        </p>
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="hidden sm:table-cell">Components</TableHead>
              <TableHead className="hidden md:table-cell">Monthly from</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => {
              const monthly = p.components.find((c) => c.kind === "recurring_monthly");
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium text-heading">
                      <span className="size-2 rounded-full" style={{ background: p.color ?? "var(--primary)" }} />
                      {p.name}
                    </div>
                    <div className="text-xs text-muted-foreground">{p.slug}</div>
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
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
