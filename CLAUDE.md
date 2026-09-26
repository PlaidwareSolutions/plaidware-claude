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
  requireOps(min), requireMembership, getTenantContext/requireTenantPage for
  client pages). Never inline role checks. Pure decision logic lives in
  `src/policy/{capabilities,tenant-status,org-guards}.ts` (client/test-safe).
- **Roles**: one table in `src/lib/roles.ts`. Tenant roles
  owner/admin/billing/member (caps read/billing/write/team; owner only by
  transfer); platform roles customer/developer/ops_support/ops_admin
  (developer = the /work area only, never tenant pages/billing/monitoring —
  a membership an ops admin adds from `/ops/users/[id]/workspaces` only
  unlocks that client's read-only brief at `/work/clients/[id]` and names
  the client on its items; support = read ops portal + messaging/triage +
  work; admin = everything, bypasses membership). `org-roles.ts` derives Better Auth's statements from
  it. Platform roles are granted only via /ops/system/access (audited; "Add
  staff" creates accounts there) or scripts/{create-ops-admin,set-platform-role}.ts.
  Members request tenant role changes from /team; owners/admins/ops decide.
- **Auth**: Better Auth + organization plugin (tenants = organizations).
  Every `/api/auth/organization/*` route except accept-invitation is disabled
  over HTTP (`src/lib/org-http-surface.ts`); org mutations go through server
  actions + `auth.api.*`, guarded by before-hooks (status gate, unique owner).
  Signup is email-verification-gated; login before verify → EMAIL_NOT_VERIFIED.
  `/settings` is the self-service account page (`src/modules/account`: profile,
  email change with one confirmation link to the new address, own sessions);
  `/update-user` and `/change-email` are disabled over HTTP.
- **DB**: Postgres + Drizzle. Schema barrel: `src/db/schema.ts` re-exports every
  module schema; migrations committed in `drizzle/`. Money = integer cents
  (`src/lib/money.ts`); statuses = pg enums; ids = uuid (Better Auth tables use text).
- **Jobs**: pg-boss in `src/worker/index.ts` (separate Railway service, same image,
  start command `npm run worker:prod`). Modules contribute via jobs.ts.
- **Email**: Resend via `src/lib/email.ts`; without RESEND_API_KEY it logs instead
  of sending (dev). Verified sending domain: contact.plaidware.com.
- **Theme**: dark-first + light, tokens only in `src/app/globals.css`
  (`@custom-variant dark`); components never use raw hex.

## Billing v2 (2026-08-16)

- Components: one base (main charge) per product + add-ons; kind one_time |
  recurring with interval/intervalCount (legacy kinds map via
  billing/mappers.resolveInterval). Per-tenant price overrides
  (tenant_price_overrides, lazily minted Stripe Prices). Mid-sub add-on
  changes prorate immediately; one-time adds invoice+charge instantly.
  invoice.upcoming renewal notices + pre-due reminders (billing_policy).
  First paid invoice promotes the card to customer default (standalone
  invoice auto-charge depends on it). Smokes: scripts/smoke-*.ts.
- Ops start (2026-09-20): `/ops/clients/[id]/billing` → Start subscription
  (`billing/start-service.ts`, pure rules in `start-logic.ts`): negotiated unit
  prices, `subscription_items.quantity` (Stripe item quantity; MRR and the
  outbound/partner contracts multiply), one-time work charged / already paid
  offline / waived, collection by emailed invoice (`collection_method:
  send_invoice`, no card) or the card on file, and a "Bill from" month: Stripe
  is created with `backdate_start_date` + `billing_cycle_anchor` (1st of next
  month) + `proration_behavior: none`, and the Hub issues ONE catch-up invoice
  tied to the subscription (per-month lines with periods; `invoices.billing_month`
  marks it). Offline money = `createOfflinePaidInvoice` (auto_advance off,
  paid out-of-band, `metadata.settlement=offline` stops the webhook echo from
  touching the subscription). Payment method `cash` exists. Setup links carry
  the same terms (quantity/settlement/billFromMonth on the invite; offline cash
  is invoiced when the link is made; finalize pays the catch-up with the saved
  card). Smoke: scripts/smoke-ops-start.ts; Stripe behavior spike:
  scripts/spike-backdate.ts.

## MHub integration (2026-08-23)

- Hub is identity+billing for the external Marketing Ops Hub
  (marketing.plaidware.com, separate repo). Hub knows only `marketing-*`
  product slugs: outbound lifecycle webhooks + provisioning handshake
  (src/modules/webhooks_out, outbox drained by the worker every minute),
  read-only partner feed (/api/partners/subscriptions, hashed `partner_keys`),
  cross-subdomain session cookie (COOKIE_DOMAIN), magic-link login.
  Env: MHUB_BASE_URL / MHUB_LIFECYCLE_URL / MHUB_WEBHOOK_SECRET.
  Ops: dead letters at /ops/system/webhooks. Details: docs/RUNBOOK.md;
  contract deviations: docs/INTEGRATION-DEVIATIONS.md.
- Marketing plan level change = cancel the old `marketing-*` subscription,
  checkout the new product; the provisioning handshake hits the existing
  MHub tenant and MHub reactivates/relevels it.

## UI page system (redesign, 2026-09)

- Ops IA is client-centric: `/ops/clients/[id]` (layout + tabs
  Overview|billing|provisioning|monitoring|people|activity), `/ops/clients/new`
  (onboarding stepper), boards at `/ops/billing`, `/ops/products/[id]` (tabs),
  `/ops/monitoring`, `/ops/inbox`, `/ops/system/*`. Old paths redirect in
  next.config.ts.
- ESLint-enforced conventions: routes only via `src/lib/routes.ts`
  (`OPS.*`, `TENANT.*`, `withQuery`); dates only via `src/lib/dates.ts`
  (fixed `NEXT_PUBLIC_DISPLAY_TZ`); confirmations only via `useConfirm()`;
  status pills only via `<StatusBadge kind status/>` (`src/lib/status-variants.ts`);
  mutations in client code via `useAction()`; one `<PageHeader>` per route,
  `<Section>`, `<StatTile>`, `<DataTableShell>`/`<TableEmpty>`, `<EmptyState>`.
  Pages call module `queries.ts` only — no raw `db.query` in page.tsx.
- User management: `/ops/users/[id]` (layout + tabs Overview|workspaces|sessions|activity,
  module `src/modules/access`) is one account — role, disable/re-enable (Better Auth
  session hook refuses disabled accounts), set-password link, session revocation,
  workspace memberships (Add to workspace = direct `tenancy.opsAddMember`, no
  invitation, audited `member_added`; Remove), and
  a cross-workspace audit timeline. `/ops/system/roles` is the read-only roles &
  permissions reference (`src/lib/role-matrices.ts` derived from the role tables;
  `src/lib/permissions-reference.ts` hand-kept — update it when a guard changes).
- Semantics: workspace status gates members via `policy.requireMembership`
  (suspended = read + billing; inactive = read); subscription holds carry
  `suspension_source` ('dunning' lifts on payment, 'manual' only by ops) and
  survive Stripe syncs; setup-link prices are held on the invite and become
  `tenant_price_overrides` (tagged `source_invite_id`) only when the client
  pays — revoke/expiry deletes them.

## Work management (2026-09)

- `src/modules/work/` — per-product development queues: one `work_boards` row
  per product (lazy, key prefix from the slug, mode kanban|sprints, 7/14-day
  cadence, advisory WIP limits), `work_items` ranked by a lexicographic string
  key within (board, status) (`rank-logic.ts`), `work_sprints` (one active per
  board, DB-enforced), comments and a per-item event trail (`event-kinds.ts`).
  Pure rules in `transitions.ts`, `sprint-logic.ts`, `key-logic.ts`.
- Area: `/work` (`WORK.*` routes, `src/app/(app)/work/**`, `WorkFrame`,
  `WORK_NAV`); boards by product slug, items by per-board number. Policy:
  `requireWork`/`requireWorkPage` (developer or any ops level),
  `requireWorkManage` (ops admin: settings, delete). `getTenantContext()`
  bounces developers to `/work`.
- **Client references reach developers only through membership**:
  `policy.workViewer()` (async) carries `tenantIds` = the developer's
  workspaces; `dto.toCardDto` spreads `requester` for ops or when the item's
  client is one of them, `visibleEvents` drops `requester_changed` naming any
  other client, `item_created` never names a client. `/work/clients` +
  `/work/clients/[id]` (developers only; ops are redirected to `/ops/clients`)
  are the read-only briefs (`listClientWorkspaces`, `getClientWorkspace`: products
  without money, people, requests). Ops-side reads (`listItemsForTenant`,
  `boardSummaryForProduct`) are called only from ops pages.
- Work actions call `refresh()` from `next/cache` after revalidating, so the
  kanban's optimistic move and the fresh tree land in one transition; client
  code in this module uses `useAction(…, { refresh: false })`. Drag and drop is
  `@dnd-kit` (explicit `DndContext id` to avoid hydration mismatches).

## Deployment (Railway project "plaidware-hub")

- Staging env: services hub-web (healthcheck /api/system/health, pre-deploy
  `npm run db:migrate:prod`), hub-worker, Postgres. 1 replica each.
- Deploy: `RAILWAY_TOKEN=<project token> railway up --service hub-web --detach`
  (same for hub-worker). The team API token in .env.credentials can't drive
  the CLI's interactive commands; use GraphQL for project-level changes.
- Staging URL: https://hub-web-staging-3ab0.up.railway.app and
  https://hub-staging.plaidware.com (Cloudflare-proxied CNAME).
- Cloudflare note: when adding a Railway custom domain, grey-cloud the record
  until Railway's cert leaves VALIDATING_OWNERSHIP, then re-proxy. If issuance
  stalls >20 min, delete + recreate the custom domain (the CNAME target
  changes — update the Cloudflare record).
- **Build-time DB rule:** Railway's builder cannot reach the private-network
  Postgres. Any page/route whose module-level render queries the DB must be
  `export const dynamic = "force-dynamic"` (no SSG/generateStaticParams over
  DB data, including sitemap.ts). Local builds mask this because localhost
  Postgres is reachable.
- Staging catalog seed: run scripts/seed.ts with DATABASE_URL from the
  Postgres TCP proxy (plus any BETTER_AUTH_SECRET/APP_BASE_URL placeholders
  to satisfy env validation).
- Secrets live in `.env.credentials` (git-ignored) and Railway service variables.
  Never commit live Stripe keys; staging uses test mode only.

## Reference

- Legacy app snapshot (requirements source): scratchpad clone of
  PlaidwareSolutions/PlaidwareHub; DB snapshots in `backups/` (git-ignored).
- Old prod data is tiny (2 users / 1 tenant / 1 subscription) — final migration
  is a small script in M11, not a bulk ETL.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Production (cut over 2026-08-13)

- **Domain split (2026-08-15):** plaidware.com (apex, Cloudflare-proxied CNAME
  → Railway) serves ONLY marketing (/, /platform, /products*, /contact, legal)
  via src/proxy.ts host routing; hub.plaidware.com is the app ("/" routes by
  session cookie). www is CF-proxied but unroutable at Railway (2-domain/service
  plan limit) — clean fix = Cloudflare Redirect Rule (needs token permission)
  or Railway plan upgrade. Old Replit site is now fully off DNS.
- Next 16: middleware.ts is deprecated → src/proxy.ts exporting `proxy()`.
- https://hub.plaidware.com — Railway env `production` (fresh secrets, LIVE
  Stripe keys + live webhook). Staging keeps test keys. Deploy with the
  env-scoped project tokens (`railway up -s hub-web|hub-worker --detach`).
- Legacy data migrated (ARCEM USA + live Stripe sub + hash-imported ingest
  key); old Replit app pending decommission; legacy DB snapshot in backups/.
