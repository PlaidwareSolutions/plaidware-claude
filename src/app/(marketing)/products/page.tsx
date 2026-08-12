import type { Metadata } from "next";
import Link from "next/link";
import { listActiveProducts } from "@/modules/catalog/queries";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Products",
  description:
    "The Plaidware portfolio: websites, construction, repair shops, driving schools, property management, HOA, and digital marketing.",
};

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  one_time: "one-time",
  recurring_monthly: "/mo",
  recurring_yearly: "/yr",
  metered: "/unit",
};

export default async function ProductsPage() {
  const products = await listActiveProducts();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16">
      <h1 className="text-3xl font-bold text-heading">Products</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Every product is priced from components: a one-time build or onboarding
        fee, a subscription, and optional add-ons. What you see is what you pay.
      </p>

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {products.map((p) => (
          <Card key={p.id} className="flex flex-col">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: p.color ?? "var(--primary)" }} />
                  {p.name}
                </CardTitle>
                <Badge variant="secondary">{p.category}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{p.tagline}</p>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <ul className="flex flex-col gap-1.5 text-sm">
                {p.components.map((c) => (
                  <li key={c.id} className="flex items-baseline justify-between gap-3">
                    <span className={c.isRequired ? "" : "text-muted-foreground"}>
                      {c.name}
                      {c.isRequired && <span className="ml-1.5 text-[10px] uppercase text-coral">required</span>}
                    </span>
                    <span className="whitespace-nowrap font-medium tabular-nums text-heading">
                      {formatCents(c.amountCents)}
                      <span className="text-xs font-normal text-muted-foreground"> {KIND_LABEL[c.kind]}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                <Link href={`/products/${p.slug}`} className="text-sm font-medium text-primary hover:underline">
                  Learn more →
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
