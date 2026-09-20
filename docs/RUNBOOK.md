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
  the delivery. Dead letters: **Ops → Webhooks** (`/ops/system/webhooks`), requeue
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

## Platform roles (ops access)

Every account has a platform role (`src/lib/roles.ts`): `customer`
(default), `developer`, `ops_support`, `ops_admin`. The role is `input: false` in the
Better Auth config, so only two writers exist, both audited on the Access
tab's "Platform activity" feed:

- **/ops/system/access** — an ops admin picks a new role on a user's row.
  Guards: you can't change your own role, an unverified account can't be
  granted an ops role, and the last ops admin can't be demoted. Changes
  that touch `ops_admin` require typing the user's email; a downgrade
  signs the user out everywhere.
- **Bootstrap** — `scripts/create-ops-admin.ts <email>` (see its header for
  the Railway invocation) for the first admin in a fresh environment.

### Add staff (developer, ops support, ops admin)

Developers see only the work area (`/work`): product boards, backlogs,
sprints and items. They never see clients, billing or monitoring, and a
developer's item payloads carry no client reference (the "Requesting client"
field is stripped server-side for them).

- **/ops/system/access → Add staff** — an ops admin enters a name, email
  and role (ops admin needs the email typed twice). The account is created
  verified with that role (audited as "Account created by ops"), a welcome
  email goes out, and Better Auth mails a set-password link (1 hour). The
  row's envelope button re-sends that link to any non-disabled account —
  including a client whose setup link died. Promoting an existing account
  works from the same table.
- **CLI** — `node --env-file=.env --import tsx scripts/set-platform-role.ts
  dev@plaidware.com developer` (Railway invocation in the script header).
  Works for any role; creates the account if needed.

## Self-service account (/settings)

Every signed-in user (clients, staff, developers) edits their own name and
phone there (`src/modules/account`; phones are normalised server-side and the
placeholder refused — this is how ops-created staff fix "not on file"), lists
and revokes their sessions, and changes their sign-in email. The email change
is single-step: one confirmation link goes to the NEW address (locally it
appears in the `[email:dev]` log) and a notice goes to the old one; the audit
row `email_change_requested` lands in the Access tab's Platform activity.
Better Auth's raw `/update-user` and `/change-email` routes are disabled.

## Client onboarding links and invitations

- **Setup links** (`/ops/clients/new`, `src/modules/onboarding`): a new client is
  created as an unverified row with no password and gets exactly one email —
  the setup link (no "confirm your email" mail; the link's password step
  creates the credential account and verifies the address). Open links can be
  **re-sent as-is** (the same `/welcome/<token>` stays valid; the raw token is
  kept encrypted under `CREDENTIALS_ENCRYPTION_KEY` — rows made before that
  can only be regenerated), **regenerated** (new token, old link dead) or
  **revoked**. A Resend failure is reported to ops instead of swallowed.
- **Workspace invitations** (Team page, People tab): valid 7 days; "Resend"
  re-mails the same invitation and moves the expiry forward; the link shows
  who invited whom where and locks signup to the invited address; accepting
  needs a verified session matching that address.
