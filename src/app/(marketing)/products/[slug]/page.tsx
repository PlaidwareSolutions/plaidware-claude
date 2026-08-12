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
      <Badge variant="secondary">{product.category}</Badge>
      <h1 className="mt-3 flex items-center gap-3 text-3xl font-bold text-heading">
        <span className="size-3 rounded-full" style={{ background: product.color ?? "var(--primary)" }} />
        {product.name}
      </h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">{product.description}</p>

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
              <Link href={`/signup?redirect=/products/${product.slug}`}>Get started</Link>
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Online checkout opens soon — signing up reserves your account.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
