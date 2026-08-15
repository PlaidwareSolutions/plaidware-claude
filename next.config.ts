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
};

export default nextConfig;
