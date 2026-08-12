import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Platform",
  description:
    "The Plaidware control plane: onboarding, provisioning, access & roles, monitoring, billing, and automations for every product in the portfolio.",
};

const PILLARS: { name: string; body: string; detail: string[] }[] = [
  {
    name: "Onboarding",
    body: "A new client goes from signup (or a sales conversation) to a provisioned, billed, monitored product without spreadsheet handoffs.",
    detail: ["Self-serve checkout with component-based pricing", "Ops-side onboarding for sold deals", "Email-verified accounts with team invites"],
  },
  {
    name: "Provisioning",
    body: "Every product instance gets its domain, DNS verification, and managed credentials tracked in one place.",
    detail: ["Custom domains with automated DNS checks", "Encrypted credential vault", "Full provisioning timeline per tenant"],
  },
  {
    name: "Access & roles",
    body: "One login across every Plaidware product, with owner, admin, billing, and member roles per workspace.",
    detail: ["Single account, multiple workspaces", "Role-based permissions", "Self-service team management"],
  },
  {
    name: "Monitoring",
    body: "Uptime probes every five minutes, business KPIs reported by each product, and daily SEO audits for websites.",
    detail: ["Uptime and response-time history", "Business metric dashboards", "Lighthouse scores with alerting"],
  },
  {
    name: "Billing",
    body: "Subscriptions, one-time fees, hosting, and ad-hoc invoices — one consolidated billing relationship, however you pay.",
    detail: ["Stripe-powered subscriptions and invoices", "Pay by card, ACH, or check", "Automatic reminders and clear statements"],
  },
  {
    name: "Automations",
    body: "The recurring work — invoicing, audits, health checks, alerts — runs on schedule in the background.",
    detail: ["Monthly hosting invoices", "Daily SEO and uptime sweeps", "Digest emails to the ops team"],
  },
];

export default function PlatformPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-coral">The control plane</p>
      <h1 className="mt-2 text-balance text-3xl font-bold text-heading sm:text-4xl">
        Six capabilities, one operational spine
      </h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Every Plaidware product plugs into the same platform, so using three
        products feels like using one.
      </p>

      <div className="mt-12 flex flex-col gap-10">
        {PILLARS.map((p, i) => (
          <section key={p.name} id={p.name.toLowerCase().replace(/[^a-z]+/g, "-")} className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <div className="font-mono text-sm text-primary">{String(i + 1).padStart(2, "0")}</div>
            <div>
              <h2 className="text-xl font-semibold text-heading">{p.name}</h2>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">{p.body}</p>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {p.detail.map((d) => (
                  <li key={d} className="flex items-center gap-2">
                    <span className="size-1 rounded-full bg-coral" />
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>

      <div className="mt-16 flex justify-center">
        <Button asChild size="lg">
          <Link href="/contact">Request a demo</Link>
        </Button>
      </div>
    </div>
  );
}
