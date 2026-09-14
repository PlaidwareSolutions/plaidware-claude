import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Staging is served via a Cloudflare Origin Rule that rewrites the Host
      // header to the Railway service domain, so the browser origin and the
      // origin-seen host differ; both must be allowed or server actions 403.
      allowedOrigins: [
        "hub-staging.plaidware.com",
        "hub-web-staging-3ab0.up.railway.app",
        "hub-web-production-4df4.up.railway.app",
        "hub.plaidware.com",
        "plaidware.com",
        "www.plaidware.com",
      ],
    },
  },
  // Ops IA moved to client-centric routes (2026-09). The client routes are
  // settled (308); the rest stay 307 until their boards finish landing —
  // browsers cache 308s forever.
  async redirects() {
    return [
      { source: "/ops/tenants", destination: "/ops/clients", permanent: true },
      { source: "/ops/tenants/:id", destination: "/ops/clients/:id", permanent: true },
      { source: "/ops/subscriptions", destination: "/ops/billing/subscriptions", permanent: false },
      { source: "/ops/incidents", destination: "/ops/monitoring", permanent: false },
      { source: "/ops/contact-inbox", destination: "/ops/inbox/leads", permanent: false },
      { source: "/ops/users", destination: "/ops/system/access", permanent: false },
      { source: "/ops/webhooks", destination: "/ops/system/webhooks", permanent: false },
      { source: "/ops/costs", destination: "/ops/system/costs", permanent: false },
      { source: "/ops/promos", destination: "/ops/system/promos", permanent: false },
    ];
  },
};

export default nextConfig;
