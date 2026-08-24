/**
 * Seed the six MHub (Marketing Ops Hub) products — the initial load; MHub
 * later owns canonical seeding from its pack files.
 * Run: node --env-file=.env --import tsx scripts/seed-marketing-catalog.ts
 * Idempotent: upserts by slug, never changes an existing component's price.
 */
import { db, pool } from "../src/db";
import {
  upsertSeedProducts,
  type SeedComponent,
  type SeedProduct,
} from "../src/modules/catalog/seed";

function addons(withSmsPack: boolean): SeedComponent[] {
  return [
    {
      kind: "recurring",
      interval: "month",
      name: "Extra location",
      description: "Local presence, listings, and campaigns for one additional location.",
      amountCents: 15_000,
    },
    {
      kind: "recurring",
      interval: "month",
      name: "Video pack",
      description: "Monthly short-form video production and distribution.",
      amountCents: 25_000,
    },
    ...(withSmsPack
      ? [
          {
            kind: "recurring",
            interval: "month",
            name: "SMS pack",
            description: "Two-way SMS campaigns and review requests.",
            amountCents: 7_500,
          } satisfies SeedComponent,
        ]
      : []),
  ];
}

function marketingProduct(opts: {
  vertical: "hs" | "dental";
  tier: "foundation" | "growth" | "expansion";
  baseCents: number;
  setupCents: number;
  tagline: string;
  features: string[];
}): SeedProduct {
  const verticalName = opts.vertical === "hs" ? "Home Services" : "Dental";
  const tierName = opts.tier[0].toUpperCase() + opts.tier.slice(1);
  const withSmsPack = opts.tier !== "foundation";
  return {
    slug: `marketing-${opts.vertical}-${opts.tier}`,
    name: `${verticalName} Marketing — ${tierName}`,
    category: "marketing",
    tagline: opts.tagline,
    description:
      `Managed ${verticalName.toLowerCase()} marketing on the Marketing Ops Hub: ` +
      `strategy, execution, and reporting run by Plaidware, tracked in your portal.`,
    features: opts.features,
    color: opts.vertical === "hs" ? "#f0663f" : "#4fb6e6",
    components: [
      {
        kind: "recurring",
        interval: "month",
        role: "base",
        name: `${tierName} plan`,
        description: `Monthly ${verticalName.toLowerCase()} marketing program (${tierName}).`,
        amountCents: opts.baseCents,
      },
      {
        kind: "one_time",
        name: "Setup",
        description: "Onboarding, audit, tracking, and campaign build-out.",
        amountCents: opts.setupCents,
        isRequired: true,
      },
      ...addons(withSmsPack),
    ],
  };
}

const MARKETING_CATALOG: SeedProduct[] = [
  marketingProduct({
    vertical: "hs",
    tier: "foundation",
    baseCents: 69_500,
    setupCents: 45_000,
    tagline: "Get found and get calls — the home services essentials.",
    features: [
      "Local SEO and listings management",
      "Google Business Profile optimization",
      "Review generation and monitoring",
      "Monthly performance report",
    ],
  }),
  marketingProduct({
    vertical: "hs",
    tier: "growth",
    baseCents: 129_500,
    setupCents: 75_000,
    tagline: "Paid search and a lead engine on top of the essentials.",
    features: [
      "Everything in Foundation",
      "Google Ads management",
      "Landing pages and call tracking",
      "Quarterly strategy sessions",
    ],
  }),
  marketingProduct({
    vertical: "hs",
    tier: "expansion",
    baseCents: 229_500,
    setupCents: 125_000,
    tagline: "Multi-channel growth for home services operators ready to scale.",
    features: [
      "Everything in Growth",
      "Paid social and remarketing",
      "Content and email programs",
      "Dedicated marketing lead",
    ],
  }),
  marketingProduct({
    vertical: "dental",
    tier: "foundation",
    baseCents: 89_500,
    setupCents: 60_000,
    tagline: "Fill chairs with a findable, trusted practice presence.",
    features: [
      "Local SEO and listings management",
      "Practice reputation and reviews",
      "Website content refresh",
      "Monthly performance report",
    ],
  }),
  marketingProduct({
    vertical: "dental",
    tier: "growth",
    baseCents: 164_500,
    setupCents: 95_000,
    tagline: "Patient acquisition campaigns on top of the essentials.",
    features: [
      "Everything in Foundation",
      "Google Ads for high-value treatments",
      "Landing pages and call tracking",
      "Quarterly strategy sessions",
    ],
  }),
  marketingProduct({
    vertical: "dental",
    tier: "expansion",
    baseCents: 279_500,
    setupCents: 150_000,
    tagline: "Full-funnel growth for multi-provider and multi-site practices.",
    features: [
      "Everything in Growth",
      "Paid social and remarketing",
      "Patient reactivation and email programs",
      "Dedicated marketing lead",
    ],
  }),
];

async function main() {
  // sortOrderBase keeps marketing products after the core catalog's 0-based ordering.
  const res = await upsertSeedProducts(db, MARKETING_CATALOG, { sortOrderBase: 100 });
  console.log(
    `Marketing catalog: ${res.products} products reconciled, ${res.componentsAdded} components added.`,
  );
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("❌", e instanceof Error ? e.message : e);
    await pool.end();
    process.exit(1);
  });
