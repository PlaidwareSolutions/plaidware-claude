# Plaidware Hub

Multi-tenant SaaS control plane for Plaidware Solutions' product portfolio.
Greenfield rebuild (Next.js) of the legacy Replit-built app; the approved PRD
is the build contract: https://claude.ai/code/artifact/ad8d5bea-3a28-4633-a74f-40e8f94ff9e9

## Commands

- `npm run dev` — dev server (Turbopack), http://localhost:3000
- `npm run worker` — pg-boss worker locally (loads .env)
- `npm run typecheck` / `npm test` / `npm run lint` — CI gate
- `npm run db:generate` / `npm run db:migrate` — Drizzle migrations (local, loads .env)
- `npm run db:migrate:prod` — migration for Railway pre-deploy (env injected)
- `npm run auth:generate` — regenerate src/modules/auth/schema.ts after auth config changes

## Architecture

- **Modular monolith.** `src/modules/<capability>/` owns schema.ts, service.ts
  (only writer), queries.ts (RSC reads → explicit DTOs), actions.ts ("use server"),
  contracts.ts (zod), jobs.ts (pg-boss), components/.
- **No internal REST.** UI uses server actions + RSC queries. Only external
  contracts get route handlers: `/api/auth/[...all]`, `/api/system/health`,
  (later) `/api/metrics/ingest`, `/api/webhooks/stripe`.
- **Authorization**: everything goes through `src/policy/` (requireUser,
  requireOps, requireMembership). Never inline role checks.
- **Auth**: Better Auth + organization plugin (tenants = organizations,
  4 roles: owner/admin/billing/member in `src/lib/org-roles.ts`).
  Signup is email-verification-gated; login before verify → EMAIL_NOT_VERIFIED.
- **DB**: Postgres + Drizzle. Schema barrel: `src/db/schema.ts` re-exports every
  module schema; migrations committed in `drizzle/`. Money = integer cents
  (`src/lib/money.ts`); statuses = pg enums; ids = uuid (Better Auth tables use text).
- **Jobs**: pg-boss in `src/worker/index.ts` (separate Railway service, same image,
  start command `npm run worker:prod`). Modules contribute via jobs.ts.
- **Email**: Resend via `src/lib/email.ts`; without RESEND_API_KEY it logs instead
  of sending (dev). Verified sending domain: contact.plaidware.com.
- **Theme**: dark-first + light, tokens only in `src/app/globals.css`
  (`@custom-variant dark`); components never use raw hex.

## Deployment (Railway project "plaidware-hub")

- Staging env: services hub-web (healthcheck /api/system/health, pre-deploy
  `npm run db:migrate:prod`), hub-worker, Postgres. 1 replica each.
- Deploy: `RAILWAY_TOKEN=<project token> railway up --service hub-web --detach`
  (same for hub-worker). The team API token in .env.credentials can't drive
  the CLI's interactive commands; use GraphQL for project-level changes.
- Staging URL: https://hub-web-staging-3ab0.up.railway.app and
  https://hub-staging.plaidware.com (Cloudflare-proxied CNAME).
- Cloudflare note: when adding a Railway custom domain, grey-cloud the record
  until Railway's cert leaves VALIDATING_OWNERSHIP, then re-proxy.
- Secrets live in `.env.credentials` (git-ignored) and Railway service variables.
  Never commit live Stripe keys; staging uses test mode only.

## Reference

- Legacy app snapshot (requirements source): scratchpad clone of
  PlaidwareSolutions/PlaidwareHub; DB snapshots in `backups/` (git-ignored).
- Old prod data is tiny (2 users / 1 tenant / 1 subscription) — final migration
  is a small script in M11, not a bulk ETL.
