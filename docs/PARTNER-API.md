# Partner API v1

The contract between Hub and an external product app that Hub bills for (a
**partner app**: Fixorata first, more later). Hub is the system of record for
prices, subscriptions, invoices, cards and dunning. The partner shows a
tenant's billing in its own UI, acts on it server-to-server, and enforces
`billing_status`.

MHub predates this and keeps its own contract (env `MHUB_*`, frozen payloads;
see RUNBOOK "MHub integration" and INTEGRATION-DEVIATIONS.md). It is not a
`partner_apps` row and cannot call v1.

For Fixorata specifically, the build brief is `docs/handoffs/fixorata-billing.md`.
It is kept in sync with this file and adds Fixorata's side of the work.

## Partner app configuration (Hub side)

A row in `partner_apps`, managed at **Ops → System → Partners**:

- **name:** stable machine name. It appears in audit actors as `partner:<name>/<email>`.
- **productPrefixes:** product slugs the app owns. Scope for the API, the
  webhooks and the "managed by" badges. Their slugs are locked against renaming.
- **webhookUrl:** lifecycle and provision deliveries. `provisionUrl` overrides
  it for the handshake.
- **webhookSecretEnc:** the HMAC secret. Encrypted with `CREDENTIALS_ENCRYPTION_KEY`.
- **allowedReturnOrigins:** the only origins `success_url`, `cancel_url` and
  `return_url` may use.
- **billingUrl:** the partner's own billing page. Hub's billing emails link
  there instead of Hub's `/billing` (via `partners/service.billingPageUrlFor`)
  for clients whose live subscriptions all belong to this app, because those
  owners have no Hub password. The link carries `?org=<external_tenant_id>`.
- **receivesMembership:** off for Fixorata.
- **status:** `disabled` stops API access and webhook delivery. Rows keep
  queueing and drain on re-enable.

Keys: `partner_keys` with `partnerAppId`, minted on the partner page (raw key
shown once) or with `scripts/mint-partner-key.ts --app <name>`. A key without
an app can only read the legacy `/api/partners/subscriptions` feed.

Tenant mapping: `partner_tenant_links (app, tenant ↔ external_tenant_id)`,
one-to-one per app in both directions. It is written by `POST /tenants`, by
the provision handshake's reply, or by ops on **Client → Provisioning →
Partner link**.

## Requests

Base: `{HUB}/api/partners/v1`, JSON.

| Header | When | |
|---|---|---|
| `X-Partner-Key` | always | `ppk_…` |
| `X-Partner-Actor` | every POST | `{"external_user_id","email","name","role"}`: the partner user acting, recorded in audit. Hub trusts the partner to have authorized them. |
| `Idempotency-Key` | every POST | ≤200 chars. A replay with the same body returns the stored response; the same key with a different body returns `409 idempotency_conflict`. 5xx responses aren't stored. Kept 24h. |

Errors are `{ "error": { "code", "message" } }`:

| Code | HTTP | Meaning |
|---|---|---|
| `unauthorized` | 401 | Key missing, invalid or revoked, or the app is disabled. |
| `validation_failed` | 400 | |
| `forbidden_scope` | 403 | Not one of the app's products. |
| `tenant_not_linked` | 404 | |
| `not_found` | 404 | |
| `workspace_locked` | 409 | Hub workspace suspended or inactive. |
| `idempotency_conflict` | 409 | |
| `rejected` | 422 | A business rule refused it; the message is shown to the user. |
| `payment_provider_error` | 502 | |
| `internal_error` | 500 | |

## Endpoints

`:ext` is the partner's tenant id. Every response only covers the app's own
products: a tenant's other Hub subscriptions, invoices and prices are invisible.

| Endpoint | Body | Response |
|---|---|---|
| `GET /tenants/:ext/billing` | — | `BillingSummary` |
| `GET /tenants/:ext/invoices?limit≤100&offset` | — | `{ invoices, next_offset? }` |
| `POST /tenants` | `{ external_tenant_id, name, owner:{email,name}, product_slug?, success_url, cancel_url? }` | 201 `{ hub_org_id, billing_status, payment_url \| null }` |
| `POST /tenants/:ext/checkout` | `{ success_url, cancel_url?, product_slug? }` | `{ hub_org_id, billing_status, payment_url \| null }` |
| `PATCH /tenants/:ext` | `{ name?, billing_email?, billing_name? }` | `BillingSummary` |
| `POST /tenants/:ext/portal-session` | `{ return_url }` | `{ url }` (Stripe Billing Portal) |
| `POST /tenants/:ext/subscriptions/:sid/items` | `{ changes:[{component_id, quantity}] }` | `BillingSummary` |
| `POST /tenants/:ext/subscriptions/:sid/cancel` | `{ at_period_end?=true, reason? }` | `BillingSummary` |
| `POST /tenants/:ext/subscriptions/:sid/resume` | `{}` | `BillingSummary` |

**Semantics:**

- **`POST /tenants`** finds the linked workspace, or creates one. The owner's
  Hub account is created without a password or emails, and each partner tenant
  gets its own workspace. Then it runs checkout.
- **Checkout** returns a pay link while something is owed, and `null` once
  settled. A closed (`canceled`/`expired`) subscription starts a new one with
  no second trial (`skipTrial` once the tenant has had that product). Before
  deciding, an `incomplete` subscription that Stripe has already expired is
  synced.
- **Trials** (product `trialDays`):
  - **Start:** `POST /tenants` starts the trial with **no card** and returns
    `payment_url: null`.
  - **During the trial:** `POST /checkout` returns a "save card" link. It
    confirms the subscription's pending SetupIntent, and Stripe makes that
    card the subscription default within seconds.
  - **Trial ends without a card:** partner checkouts set
    `trial_settings.end_behavior.missing_payment_method: "cancel"`, so Stripe
    ends the subscription at the trial end with no invoice and no dunning.
    `billing.isTrialLapse` maps that cancellation to local `expired`, and
    Hub sends `subscription.expired`. Reactivating through `/checkout`
    charges the first month at once.
  - Verified on the real API with test clocks: `scripts/spike-trial-no-card.ts`.
  - The trial-ending email asks for a card when none is on file.
- **The pay link** is `{HUB}/pay/<token>` (`partner_pay_links`, SHA-256 token,
  23h expiry). It needs no login: it shows the plan and Stripe's
  PaymentElement (or SetupIntent for a trial), then redirects to
  `success_url`. A failed 3DS redirect returns to the pay page.
- **Items** sets the exact quantity of a recurring add-on (0 removes it).
  Prorations go on the next invoice. A one-time add-on with quantity > 0 is a
  purchase invoiced and charged now. The base charge is refused.
- **Cancel** with `at_period_end` uses `billing.setCancelAtPeriodEnd`: the
  subscription stays live with `cancel_at_period_end: true` until Stripe ends
  it. With `false`, `billing.cancelSubscription` cancels it now.
- **PATCH** renames the workspace and sets the partner-maintained billing
  contact (`partner_tenant_links.billingEmail`/`billingName`). That contact
  becomes the recipient of every Hub billing email for the client (via
  `billingContactOverride`) and the Stripe customer's name and email. Hub
  logins are untouched.
- Items, cancel and resume need the Hub workspace to allow writes. Checkout
  goes through `createCheckout`'s own workspace rule.

`BillingSummary` (snake_case), from `partners/api-queries.ts`:

```text
hub_org_id, external_tenant_id, billing_status, workspace_status
subscription: null | {
  hub_subscription_id, product_slug, product_name, plan_key: standard|custom, status,
  trial_ends_at, current_period_end, cancel_at_period_end, canceled_at,
  suspension: null | { source: dunning|manual, since, note },
  monthly_total_cents,
  items[]: { id, component_id, name, role: base|addon, kind, interval,
             interval_count, unit_amount_cents, quantity, status },
  addon_options[]: { component_id, name, kind, interval, unit_amount_cents,
                     current_quantity }
}
payment_method: null | { type, brand|null, last4|null, exp_month|null, exp_year|null, label }
                (any default Stripe holds — card, Link, bank…; card fields only for cards)
collection_method: charge_automatically | send_invoice | null
next_charge: null | { date, amount_cents }   (null while a period-end cancel is set)
invoices[]: latest 20 Invoice
Invoice: { id, number, status, amount_due_cents, amount_paid_cents, created_at,
           due_date, paid_at, period_start, period_end, hosted_invoice_url,
           invoice_pdf_url }
```

**The subscription shown** is the live one (one live per product is
DB-enforced), else the most recent closed one.

**Stripe facts** (`payment_method`, `collection_method`, `next_charge`) are
read live and cached for 60s per tenant. Mutations clear the cache.

**`billing_status`** comes from the subscription status
(`partners/logic.billingStatusFor`):

| Subscription | `billing_status` |
|---|---|
| none | `none` |
| `incomplete` | `pending` |
| `trialing`, `active`, `past_due`, `suspended`, `canceled`, `expired` | the same value |
| any live status while the Hub workspace is `suspended` or `inactive` | `suspended` |

**`plan_key`** (`partners/service.partnerPlanKey`) is `custom` when the
client has a tenant price override on the product's base charge (a
negotiated price), and `standard` otherwise.

## Webhooks to the partner

These are the same outbox, signing and retry rules as MHub (`webhooks_out`):

- **Signing:** `X-Plaidware-Signature: sha256=hex(HMAC(secret, "${ts}.${rawBody}"))`,
  plus `X-Plaidware-Event`, `X-Plaidware-Delivery` (stable across retries) and
  `X-Plaidware-Timestamp`.
- **Retries:** 1m, 5m, 30m, 2h and 12h, then the delivery is dead-lettered
  (Ops → System → Webhooks). A 410 disables the delivery.

**Events:**

- **`subscription.activated | updated | past_due | suspended | canceled | expired`**
  - Body: `{event, data}`, where `data` is `{ hub_subscription_id, hub_org_id,
    product_slug, status, current_period_end, addon_components[{name,quantity}],
    external_tenant_id | null, billing_status, plan_key, trial_ends_at,
    cancel_at_period_end, canceled_at, suspension_source: dunning|manual|null,
    card_on_file: boolean|null, occurred_at }`.
  - `card_on_file` is read from Stripe at emit time (the subscription's
    default, else the customer's); `null` means Stripe couldn't be reached,
    and the partner keeps its prior value.
  - MHub's payload lacks everything after `addon_components`.
  - `occurred_at` is the emit time. The header timestamp and signature are
    fresh on every attempt, so partners order events by `occurred_at`.
  - Ops changing the Hub workspace status emits `updated` for the client's
    partner subscriptions (`emitWorkspaceStatusToPartners`).
  - `updated` also fires for period-end cancel and resume, and for add-on changes.
- **`provision.requested`**
  - Sent on the first activation.
  - Flat body: `{ hub_subscription_id, hub_org_id, product_slug, org_name,
    org_slug, owner_email, owner_name, external_tenant_id? }`. The external
    id is present when a link already exists.
  - The partner replies `{ external_tenant_id, portal_url? }`. Hub stores the
    link and the portal URL.
  - A reply without `external_tenant_id` is retried.
  - A reply whose external id is already linked to a different tenant is
    disabled with a "link conflict" error for ops.
- **`organization.updated`:** `{ hub_org_id, name, slug }`.
- **`membership.changed`:** only for apps with `receivesMembership`.

The partner answers 2xx `{"status":"processed"|"ignored"|"duplicate"}`.
Any 5xx means retry.

## Tests

- **Unit:** `src/modules/partners/logic.test.ts`.
- **API end to end** (Stripe test mode, local DB, in-process handlers):
  `scripts/smoke-partner-billing.ts`.
- **Outbound webhooks:** `scripts/smoke-partner-webhooks.ts`, which also
  proves MHub rows are untouched.
- **MHub regression:** `scripts/smoke-webhooks.ts`.
