import Link from "next/link";
import type { Metadata } from "next";
import {
  Activity,
  CreditCard,
  KeyRound,
  Rocket,
  Workflow,
  Globe,
} from "lucide-react";
import { listActiveProducts } from "@/modules/catalog/queries";
import { formatCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Plaidware — One control plane for every product",
  description:
    "Plaidware builds and runs software for small businesses: websites, vertical SaaS, and digital marketing — managed from a single control plane.",
};

const PILLARS = [
  { icon: Rocket, name: "Onboarding", text: "From signed proposal to live product without a handoff gap." },
  { icon: Globe, name: "Provisioning", text: "Domains, DNS, and hosting managed and verified for you." },
  { icon: KeyRound, name: "Access & roles", text: "One login for your whole team, with the right permissions." },
  { icon: Activity, name: "Monitoring", text: "Uptime probes, business KPIs, and SEO audits — watched daily." },
  { icon: CreditCard, name: "Billing", text: "One consolidated invoice across every product you use." },
  { icon: Workflow, name: "Automations", text: "The routine work happens on schedule, not when someone remembers." },
];

export default async function HomePage() {
  const products = await listActiveProducts();

  return (
    <>
      <section className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 py-20 text-center sm:py-28">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-coral">
          Accelerating business throughput
        </p>
        <h1 className="max-w-3xl text-balance text-4xl font-bold tracking-tight text-heading sm:text-5xl">
          One control plane for every Plaidware product
        </h1>
        <p className="max-w-xl text-balance text-muted-foreground">
          Websites, vertical SaaS, and digital marketing for small businesses —
          built for you, run for you, and managed from a single dashboard with a
          single invoice.
        </p>
        <div className="flex gap-3">
          <Button asChild size="lg">
            <Link href="/products">Browse products</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/contact">Request a demo</Link>
          </Button>
        </div>
      </section>

      <section className="border-y bg-card/50">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-16 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((p) => (
            <div key={p.name} className="flex gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <p.icon className="size-5" />
              </div>
              <div>
                <h3 className="font-semibold text-heading">{p.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{p.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-heading">The portfolio</h2>
            <p className="text-sm text-muted-foreground">
              Purpose-built products, one operational spine.
            </p>
          </div>
          <Button asChild variant="ghost">
            <Link href="/products">View all →</Link>
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.slice(0, 6).map((p) => {
            const monthly = p.components.find((c) => c.kind === "recurring_monthly");
            return (
              <Link key={p.id} href={`/products/${p.slug}`}>
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardHeader>
                    <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                      {p.category}
                    </div>
                    <CardTitle className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full" style={{ background: p.color ?? "var(--primary)" }} />
                      {p.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <p className="text-sm text-muted-foreground">{p.tagline}</p>
                    {monthly && (
                      <p className="text-sm font-medium text-heading">
                        from {formatCents(monthly.amountCents)}/mo
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="border-t bg-card/50">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-4 py-16 text-center">
          <h2 className="text-2xl font-semibold text-heading">
            Ready to run your business on Plaidware?
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Pick a product and check out in minutes, or talk to us about what
            you need.
          </p>
          <div className="flex gap-3">
            <Button asChild>
              <Link href="/signup">Get started</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/contact">Talk to us</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
