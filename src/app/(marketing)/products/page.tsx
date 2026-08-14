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

const PRODUCT_IMAGES: Record<string, string> = {
  "company-website": "/images/products/company-website.png",
  buildorata: "/images/products/buildorata.png",
  fixorata: "/images/products/fixorata.png",
  drivorata: "/images/products/drivorata.png",
  rentorata: "/images/products/rentorata.png",
  proporata: "/images/products/proporata.png",
  "digital-marketing": "/images/products/digital-marketing.png",
};

export default async function ProductsPage() {
  const products = await listActiveProducts();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16">
      <p className="mb-3 text-xs uppercase tracking-widest text-primary">Product catalog</p>
      <h1 className="text-3xl font-semibold tracking-tight text-heading sm:text-5xl">Products</h1>
      <p className="mt-3 max-w-2xl text-sm font-light text-muted-foreground sm:text-base">
        Every product is priced from components: a one-time build or onboarding
        fee, a subscription, and optional add-ons. What you see is what you pay.
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {products.map((p) => (
          <Card key={p.id} className="group flex flex-col overflow-hidden pt-0 transition-all duration-200 hover:shadow-lg">
            {PRODUCT_IMAGES[p.slug] && (
              <Link href={`/products/${p.slug}`} className="relative block aspect-[16/9] w-full overflow-hidden bg-secondary">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={PRODUCT_IMAGES[p.slug]}
                  alt={p.name}
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              </Link>
            )}
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-xl font-bold text-heading sm:text-2xl">{p.name}</CardTitle>
                <Badge variant="secondary">{p.category}</Badge>
              </div>
              <p className="text-xs text-muted-foreground sm:text-sm">{p.tagline}</p>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <ul className="flex flex-col gap-1.5">
                {p.components.map((c) => (
                  <li key={c.id} className="flex items-baseline justify-between gap-3 text-xs sm:text-sm">
                    <span className={c.isRequired ? "text-foreground" : "text-muted-foreground"}>
                      {c.name}
                      {c.isRequired && <span className="ml-1.5 text-[10px] uppercase text-coral">required</span>}
                    </span>
                    <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-heading">
                      {formatCents(c.amountCents)}
                      <span className="text-xs font-normal text-muted-foreground"> {KIND_LABEL[c.kind]}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                <Link href={`/products/${p.slug}`} className="text-sm font-semibold text-primary hover:underline">
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
