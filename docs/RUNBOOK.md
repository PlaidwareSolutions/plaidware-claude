# Runbook

Operational notes that don't belong in CLAUDE.md's build contract.

## MHub integration (marketing.plaidware.com)

Hub is MHub's identity and billing system of record; it knows zero marketing
concepts — only products whose slug starts with `marketing-`. Surfaces:

- **Session introspection**: MHub forwards the user's cookie to
  `GET /api/auth/get-session`. Requires `COOKIE_DOMAIN=.plaidware.com` in the
  deployed env so the session cookie spans subdomains (unset locally).
  The cookie NAME is per-environment (`COOKIE_PREFIX`, default `better-auth`):
  prod `__Secure-better-auth.session_token`, staging
  `__Secure-plaidware-staging.session_token` — distinct names so one env's
  sign-in can't clobber the other's session on the shared cookie domain.
  MHub's hub-mode "Sign out" clears the cookie by name via its
  `HUB_SESSION_COOKIE` env var — any rename here must be mirrored there.
  Cross-app sign-in hand-off: `{hub}/login?redirect=<url-encoded target>`;
  targets are sanitized (`src/lib/safe-redirect.ts`) to same-app paths or
  https `*.plaidware.com`, and magic-link/signup `callbackURL`s are further
  checked against `TRUSTED_ORIGINS` (must include the MHub origin).
- **Lifecycle webhooks** (Hub → MHub): `src/modules/webhooks_out/` writes an
  outbox row per event; the worker's `webhooks.deliver-due` job (every minute)
  POSTs to `MHUB_LIFECYCLE_URL` signed with `MHUB_WEBHOOK_SECRET`
  (`X-Plaidware-Signature: sha256=` HMAC of `${timestamp}.${rawBody}`).
  Retry backoff 1m/5m/30m/2h/12h, then dead-letter. A 410 response disables
  the delivery. Dead letters: **Ops → Webhooks** (`/ops/webhooks`), requeue
  restarts the backoff with the same `X-Plaidware-Delivery` id. With MHub env
  unset the sweep no-ops and rows queue untouched.
- **Provisioning handshake**: first activation of a `marketing-*` subscription
  POSTs `{MHUB_BASE_URL}/api/hub/provision` (same signing); the returned
  `portal_url` lands in `subscription_provisioning.domainUrl`. DNS
  verification is skipped for `marketing-*` products — until the handshake
  succeeds the subscription shows "Provisioning pending" (billing view and
  ops tenant page).
- **Partner feed**: `GET /api/partners/subscriptions?product_prefix=marketing-`
  with `X-Partner-Key`, MHub's reconciliation path for missed events. Mint a
  key: `node --env-file=.env --import tsx scripts/mint-partner-key.ts
  mhub-staging marketing-` (raw key shown once; only the SHA-256 hash is
  stored, in `partner_keys`).
- **Catalog**: `node --env-file=.env --import tsx
  scripts/seed-marketing-catalog.ts` seeds the six `marketing-*` products
  (idempotent; MHub later owns canonical seeding from its pack files).
- Contract deviations/clarifications: see `docs/INTEGRATION-DEVIATIONS.md`.

### Marketing plan level change

Marketing plan level change = cancel the old `marketing-*` subscription, then
checkout the new product. The provisioning handshake will hit an existing MHub
tenant and MHub reactivates/relevels it — Hub does nothing special.

### Magic-link sign-in

Login page offers "Email me a sign-in link" (Better Auth magic-link plugin,
5-minute single-use links, sign-in only — signup still requires the form since
it collects name/phone). Verifying a link marks the email verified.
