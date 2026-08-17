import { eq, and } from "drizzle-orm";
import type { Db } from "../../db";
import { productComponents, products } from "./schema";
import { productMetricDefinitions } from "../monitoring/schema";

/** KPI contracts (PRD §4.8) — seeded for Company Website like the legacy app. */
const METRIC_DEFS: Record<
  string,
  { key: string; label: string; unit?: string; valueType?: string; aggregation?: string; isPrimary?: boolean }[]
> = {
  "company-website": [
    { key: "page_views", label: "Page views", unit: "views", isPrimary: true },
    { key: "leads_submitted", label: "Leads submitted", unit: "leads" },
    { key: "contact_form_submissions", label: "Contact form submissions" },
    { key: "avg_session_seconds", label: "Avg session", unit: "s", valueType: "duration_seconds", aggregation: "avg" },
  ],
};

type SeedComponent = {
  kind: "one_time" | "recurring";
  interval?: "week" | "month" | "year";
  intervalCount?: number;
  role?: "base";
  name: string;
  description?: string;
  amountCents: number;
  isRequired?: boolean;
};

type SeedProduct = {
  slug: string;
  name: string;
  category: string;
  tagline: string;
  description: string;
  features: string[];
  color: string;
  components: SeedComponent[];
};

/** PRD §3 — today's catalog. Ops edits live data; the seed only reconciles
 *  copy/structure and adds missing rows. It NEVER updates an existing
 *  component's price (same contract as the legacy seed). */
const CATALOG: SeedProduct[] = [
  {
    slug: "company-website",
    name: "Company Website",
    category: "Marketing & Web",
    tagline: "A fast, findable website — designed, built, and maintained.",
    description:
      "A professionally built business website with hosting, maintenance, and built-in SEO monitoring. Your site's performance is audited daily and issues reach a human before they reach your customers.",
    features: [
      "Custom design and build",
      "Managed hosting and TLS",
      "Daily Lighthouse/SEO audits",
      "Uptime monitoring with incident response",
      "Annual maintenance option",
    ],
    color: "#7a6cf0",
    components: [
      { kind: "one_time", role: "base", name: "Initial Build", amountCents: 450000, isRequired: true, description: "Design, build, and launch of your website" },
      { kind: "recurring", interval: "month", name: "Hosting", amountCents: 7900, description: "Managed hosting, TLS, and monitoring" },
      { kind: "recurring", interval: "year", name: "Maintenance", amountCents: 96000, description: "Content updates and annual refresh" },
    ],
  },
  {
    slug: "buildorata",
    name: "Buildorata",
    category: "Construction",
    tagline: "Construction management for small crews.",
    description:
      "Project scheduling, crew coordination, and client communication for small construction businesses — without the enterprise overhead.",
    features: ["Project scheduling", "Crew assignments", "Client updates", "Document storage", "Compliance backups"],
    color: "#f0663f",
    components: [
      { kind: "one_time", name: "Onboarding & Setup", amountCents: 250000, isRequired: true },
      { kind: "recurring", interval: "month", role: "base", name: "Subscription", amountCents: 19900, isRequired: true },
      { kind: "recurring", interval: "year", name: "Annual Compliance & Backup", amountCents: 48000 },
    ],
  },
  {
    slug: "fixorata",
    name: "Fixorata",
    category: "Repair Shops",
    tagline: "Run the counter, the bench, and the books.",
    description:
      "Ticketing, point-of-sale integration, and customer notifications for repair shops. Works with your existing Clover or Square terminals.",
    features: ["Repair ticketing", "Clover/Square integration", "Customer SMS updates", "Parts tracking", "Multi-terminal support"],
    color: "#34d399",
    components: [
      { kind: "one_time", name: "Onboarding + POS Integration", amountCents: 150000, isRequired: true },
      { kind: "recurring", interval: "month", role: "base", name: "Subscription", amountCents: 14900, isRequired: true },
      { kind: "recurring", interval: "month", name: "Extra Terminal", amountCents: 3900 },
    ],
  },
  {
    slug: "drivorata",
    name: "Drivorata",
    category: "Driving Schools",
    tagline: "Scheduling and student management for driving schools.",
    description:
      "Lesson scheduling, instructor management, student progress tracking, and payments for driving schools of any size.",
    features: ["Lesson scheduling", "Instructor calendars", "Student progress", "Payment tracking", "Multi-location support"],
    color: "#fbbf24",
    components: [
      { kind: "one_time", name: "School Onboarding", amountCents: 120000, isRequired: true },
      { kind: "recurring", interval: "month", role: "base", name: "Subscription", amountCents: 12900, isRequired: true },
      { kind: "recurring", interval: "month", name: "Extra Location", amountCents: 5900 },
    ],
  },
  {
    slug: "rentorata",
    name: "Rentorata",
    category: "Property Management",
    tagline: "Property management without the paperwork.",
    description:
      "Lease tracking, maintenance requests, and resident billing for independent property managers.",
    features: ["Lease management", "Maintenance requests", "Resident portal", "Billing & payments", "Owner reporting"],
    color: "#60a5fa",
    components: [
      { kind: "one_time", name: "Property Onboarding", amountCents: 180000, isRequired: true },
      { kind: "recurring", interval: "month", role: "base", name: "Subscription per Property", amountCents: 22900, isRequired: true },
      { kind: "recurring", interval: "year", name: "Resident Billing & Payments", amountCents: 120000 },
    ],
  },
  {
    slug: "proporata",
    name: "PropOrata",
    category: "Property Management",
    tagline: "HOA management that boards actually like.",
    description:
      "Dues collection, violation tracking, architectural requests, and board communication for homeowners associations up to and beyond 100 units.",
    features: ["Dues & assessments", "Violation tracking", "ARC requests", "Board portal", "Compliance backups"],
    color: "#c084fc",
    components: [
      { kind: "one_time", name: "Onboarding & Setup", amountCents: 500000, isRequired: true },
      { kind: "recurring", interval: "month", role: "base", name: "Subscription (up to 100 units)", amountCents: 14900, isRequired: true },
      { kind: "recurring", interval: "month", name: "Additional Units (per 50)", amountCents: 4900 },
      { kind: "recurring", interval: "year", name: "Annual Compliance & Backup", amountCents: 24000 },
    ],
  },
  {
    slug: "digital-marketing",
    name: "Digital Marketing",
    category: "Marketing & Web",
    tagline: "A marketing department, by subscription.",
    description:
      "SEO, paid advertising, content, social, and email — run by the team that already runs your website. Pick the channels that fit; scale up or down monthly.",
    features: ["SEO retainer", "Paid ads management", "Content production", "Social management", "Email campaigns", "Quarterly strategy reviews"],
    color: "#f472b6",
    components: [
      { kind: "one_time", role: "base", name: "Onboarding & Strategy Audit", amountCents: 150000, isRequired: true },
      { kind: "recurring", interval: "month", name: "SEO Retainer", amountCents: 89900 },
      { kind: "recurring", interval: "month", name: "Paid Ads Management", amountCents: 120000 },
      { kind: "recurring", interval: "month", name: "Content Production", amountCents: 79900 },
      { kind: "recurring", interval: "month", name: "Social Management", amountCents: 69900 },
      { kind: "recurring", interval: "month", name: "Email Campaigns", amountCents: 49900 },
      { kind: "recurring", interval: "year", name: "Quarterly Strategy Review", amountCents: 120000 },
    ],
  },
  {
    slug: "custom-application",
    name: "Custom Application",
    category: "Custom Software",
    tagline: "Software built for your business, hosted and cared for by ours.",
    description:
      "A custom-built web application — scheduling, booking, portals, workflows — designed for your business and run on managed hosting with monitoring, backups, and a real human when you need one.",
    features: [
      "Custom design and build",
      "Managed application hosting",
      "Managed website hosting",
      "Domain registration & renewal",
      "Uptime monitoring",
      "Optional annual maintenance",
    ],
    color: "#38bdf8",
    components: [
      { kind: "recurring", interval: "month", role: "base", name: "Website Hosting", amountCents: 3500, isRequired: true, description: "Managed hosting for your website" },
      { kind: "recurring", interval: "month", name: "Application Hosting", amountCents: 4500, isRequired: true, description: "Managed hosting for your custom application" },
      { kind: "recurring", interval: "year", name: "Domain Renewal", amountCents: 2200, description: "Domain registration kept current, every year" },
      { kind: "one_time", name: "Website Application Build", amountCents: 50000, description: "Design and build of your custom application" },
      { kind: "recurring", interval: "year", name: "Annual Maintenance", amountCents: 96000, description: "Updates, fixes, and an annual refresh" },
    ],
  },
];

export async function seedCatalog(db: Db): Promise<{ products: number; componentsAdded: number }> {
  let componentsAdded = 0;
  for (const [i, p] of CATALOG.entries()) {
    const existing = await db.query.products.findFirst({
      where: eq(products.slug, p.slug),
    });
    const values = {
      name: p.name,
      category: p.category,
      tagline: p.tagline,
      description: p.description,
      features: p.features,
      color: p.color,
      sortOrder: i,
    };
    const productId = existing
      ? (await db.update(products).set(values).where(eq(products.id, existing.id)), existing.id)
      : (await db.insert(products).values({ slug: p.slug, ...values }).returning({ id: products.id }))[0].id;

    for (const [j, d] of (METRIC_DEFS[p.slug] ?? []).entries()) {
      await db
        .insert(productMetricDefinitions)
        .values({
          productId,
          key: d.key,
          label: d.label,
          unit: d.unit,
          valueType: d.valueType ?? "count",
          aggregation: d.aggregation ?? "sum",
          isPrimary: d.isPrimary ?? false,
          displayOrder: j,
        })
        .onConflictDoNothing();
    }

    for (const [j, c] of p.components.entries()) {
      const found = await db.query.productComponents.findFirst({
        where: and(eq(productComponents.productId, productId), eq(productComponents.name, c.name)),
      });
      if (found) {
        // Reconcile structure/copy; never touch price of an existing component.
        await db
          .update(productComponents)
          .set({
            kind: c.kind,
            interval: c.interval ?? null,
            intervalCount: c.intervalCount ?? 1,
            role: c.role ?? "addon",
            description: c.description,
            isRequired: c.isRequired ?? false,
            sortOrder: j,
          })
          .where(eq(productComponents.id, found.id));
      } else {
        await db.insert(productComponents).values({
          productId,
          kind: c.kind,
          interval: c.interval ?? null,
          intervalCount: c.intervalCount ?? 1,
          role: c.role ?? "addon",
          name: c.name,
          description: c.description,
          amountCents: c.amountCents,
          isRequired: c.isRequired ?? false,
          sortOrder: j,
        });
        componentsAdded++;
      }
    }
  }
  return { products: CATALOG.length, componentsAdded };
}
