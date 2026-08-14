import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { getProductBySlug } from "@/modules/catalog/queries";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  one_time: "one-time",
  recurring_monthly: "per month",
  recurring_yearly: "per year",
  metered: "per unit",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return {};
  return {
    title: product.name,
    description: product.tagline ?? product.description.slice(0, 150),
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-16">
      <div className="relative mb-8 aspect-[21/9] w-full overflow-hidden rounded-xl border bg-secondary">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/images/products/${product.slug}.png`} alt={product.name} className="size-full object-cover" />
      </div>
      <Badge variant="secondary">{product.category}</Badge>
      <h1 className="mt-3 text-3xl font-bold text-heading sm:text-4xl">{product.name}</h1>
      <p className="mt-3 max-w-2xl text-sm font-light text-muted-foreground sm:text-base">{product.description}</p>

      <div className="mt-10 grid gap-8 md:grid-cols-[1fr_320px]">
        <div>
          <h2 className="text-lg font-semibold text-heading">What&apos;s included</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {product.features.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm">
                <Check className="size-4 text-success" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pricing</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {product.components.map((c) => (
              <div key={c.id} className="flex items-baseline justify-between gap-3 text-sm">
                <div>
                  <div className={c.isRequired ? "font-medium" : ""}>{c.name}</div>
                  {c.isRequired && (
                    <div className="text-[10px] uppercase tracking-wide text-coral">required</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums text-heading">
                    {formatCents(c.amountCents)}
                  </div>
                  <div className="text-xs text-muted-foreground">{KIND_LABEL[c.kind]}</div>
                </div>
              </div>
            ))}
            <Button asChild className="mt-2">
              <Link href={`/checkout?product=${product.slug}`}>Get started</Link>
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Secure checkout · cancel anytime
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
