# Plaidware Hub billing for Fixorata — integration brief

**Status: v1.0 (2026-10-19). Staging complete: joint end-to-end test and owner walkthrough passed.** Hub's side is live in production but switched off (no Fixorata partner app there yet). The Partner API is implemented in Hub
and passes its smoke tests locally; it becomes **v1 (frozen)** once it is live
on hub-staging. Source of truth for the contract: Plaidware Hub
`docs/PARTNER-API.md`.

**v0.97 answers the review in `plaidware-hub-deviations.md`.** §7 answers it
item by item. Where this brief and the review's §A or §E disagree on
Fixorata's internals, **the review wins**: it was written against `develop`,
and this brief's first draft was not. §4 now follows the review's build plan.

Changes in v1.0-rc: lifecycle `data` adds `card_on_file`, `suspension_source` and `canceled_at`, so the whole display mirror is webhook-driven (answers deviations 19 and 21 from step 4). Fixtures re-exported.

Changes in v0.99: once Hub records a link from a provision reply, it re-sends the current state as `subscription.updated` (B.19). A duplicate provision reply must still include `external_tenant_id` (B.20).

Changes in v0.98: the answers to review items B.14–B.18 (§7), and re-exported fixtures. Every response file is now `{status, body}`, there's a real `past_due` shop, and the first invoices page has `next_offset`. A closed subscription's `items` now lists the plan as it was, the same way for canceled and expired.

Changes in v0.97 (Hub side, all implemented and tested):
- **A trial that ends without a card now expires.** No invoice and no dunning: Hub sends `subscription.expired` and `billing_status` becomes `expired`. This replaces the v0.96 rule.
- **Plans:** `plan_key` (`standard` | `custom`) is in `BillingSummary.subscription` and in lifecycle `data`.
- **More lifecycle `data` fields:** `occurred_at`, `trial_ends_at` and `cancel_at_period_end`.
- **Workspace holds:** a Hub workspace hold (ops suspended or deactivated the client) folds into `billing_status: "suspended"`, and Hub announces it with `subscription.updated`.
- **New endpoint:** `PATCH /tenants/:ext` with `{ name?, billing_email?, billing_name? }`.
- **Email links:** Hub's billing email links carry `?org=<external_tenant_id>`.

Changes in v0.96 (pricing aligned with fixorata.com):
- A sign-up now starts a 30-day free trial with no card. `POST /tenants` returns `billing_status: "trialing"` and `payment_url: null`; there is no redirect.
- The plan is $35/month for one store. There is no onboarding fee and no add-ons.
- During the trial, `POST /checkout` returns an "add a card" link.
- Reactivating a subscription never grants a second trial.
- Hub's billing emails link to your billing page.

Changes since v0.9:
- `payment_url` is a Hub pay page, not a Stripe hosted invoice.
- Recurring add-on changes are billed on the next invoice.
- `portal-session` needs the actor and `Idempotency-Key` headers like every POST.
- Error codes `not_found`, `rejected` and `internal_error` were added.
- `product_slug` is optional.
- `cancel` accepts `at_period_end: false` (cancel now).

Audience: the Claude Code session working in `fixorata-claude`.

## §1. What's changing and why
Plaidware Hub (https://hub.plaidware.com; staging https://hub-staging.plaidware.com) is Plaidware Solutions' billing and identity control plane. It already runs Stripe for every Plaidware product. **From now on, all Fixorata billing lives in Hub**: prices, subscriptions, invoices, cards, dunning and suspension.

Fixorata stops being a billing system:
- It **displays** a shop's billing.
- It **lets owners act on it** by calling Hub's Partner API from the Express server.
- It **enforces** Hub's billing state in its own access rules.

Shop owners never need a Hub login. Card details are only ever entered on Stripe-run forms, so Fixorata never touches card data and needs no Stripe SDK:
- To start, complete or reactivate a subscription, the owner uses Hub's no-login pay page (`https://hub.plaidware.com/pay/<token>`). It embeds Stripe's card form, then redirects back to your `success_url`.
- To update a card, the owner uses Stripe's Billing Portal.
- To pay an open invoice, the owner uses Stripe's hosted invoice page.

Hub also sends its normal billing emails (receipts, renewal notices, dunning reminders, and a "trial ends in 3 days" notice that asks for a card when none is on file), under the Plaidware name. They go to the billing contact you keep current with `PATCH /tenants/:ext`; until you set one, they go to the owner Hub recorded at signup. Their links go to your billing page with `?org=<external_tenant_id>`.

**Pricing, as advertised on fixorata.com and configured in Hub:**
- **Free trial:** 30 days, every feature, no card needed to start.
- **Standard:** $35/month for one store, unlimited staff logins.
- **Custom:** multi-store shops get one negotiated flat monthly price, which Plaidware ops set in Hub for that shop.

Fixorata never hardcodes any of these amounts. Show what the API returns: a custom-priced shop's summary carries its own price. The "Custom: your price" call to action on your pricing page goes to Plaidware (contact or sales), not to a Fixorata flow.

Retire Fixorata's own subscription *logic* and keep its data. The exact list is in review A.1 and §E step 8. Keep the legacy tables, annotated ORPHANED and **never dropped** (A.7). Keep the existing read-only enforcement, the kill switch and `ORG_READ_ONLY`, and change only what feeds them (A.2, A.5, A.6). Existing production shops move to Hub as described in §7 C.

The marketing landing page may keep "$35 per month" (A.14). "Never hardcode prices" applies to the app's billing surfaces only.

SMS entitlements (`smsEnabled`, `monthlySmsLimit`, …) are **not** billing and stay as they are.

## §2. Concepts
- **Hub tenant (`hub_org_id`).** A Hub organization. One Fixorata org maps to exactly one Hub tenant, and the mapping is stored in Hub.
- **`external_tenant_id`.** Your `organizations.id` (varchar UUID). In every API path it's `:ext`. Hub never needs your slug.
- **The Fixorata product in Hub (slug `fixorata`).** One monthly base charge, "Subscription" ($35, or the shop's negotiated price), with a 30-day trial. There are no one-time charges and no add-ons today (`addon_options` is empty). The add-on endpoint exists for future use; build the add-on UI so it only renders when `addon_options` isn't empty.
  - Prices can be negotiated per shop in Hub, so **always display the amounts the API returns**. Never hardcode prices.
  - Currency is USD. All amounts are integer cents.
- **Ways a shop gets billed:**
  1. *Hub-first.* Plaidware ops onboard the shop in Hub. When the subscription activates, Hub sends you `provision.requested`, and you create the org (or link an existing one if `external_tenant_id` is present).
  2. *Fixorata-first.* A shop signs up on fixorata.com, or your platform admin onboards it. Your server calls `POST /tenants`, and the shop is `trialing` at once with no card and no redirect. Hub immediately sends `subscription.activated` and `provision.requested`. Both already carry your `external_tenant_id`; treat `provision.requested` as "link confirmed" and do not create anything.
     - During the trial, the owner adds a card from your billing page. `POST /checkout` returns a `payment_url` to Hub's pay page in "save card" mode; nothing is charged until the trial ends.
     - If the trial ends **without** a card, the subscription **expires**: no invoice and no dunning. Hub sends `subscription.expired` (`billing_status: "expired"`), and Fixorata shows read-only with "Add a card to continue". That button hits `/start`, which returns a pay link charging the first month now, with no second trial. Paying makes the shop `active`.
     - A shop that was `canceled` or `expired` and reactivates gets **no second trial**. `POST /checkout` returns a pay link that charges the first month now.
  3. *Link existing.* Ops paste your org id into Hub. The next handshake or lifecycle event carries it.
- **`billing_status`.** Hub derives this one field for you, and it is the **only** value your gate should read:
  - `none`: no Fixorata subscription.
  - `pending`: created, first payment not made. Reached only through reactivation. A linked tenant whose Hub-side start awaits its first payment can also show `pending` on a `GET`, but Hub sends no webhook for it, so keep the previously mirrored state (§7 B.13).
  - `trialing`.
  - `active`.
  - `past_due`: a payment failed and Hub is dunning (reminders on days 3, 7 and 14 by default).
  - `suspended`: dunning grace ran out, ops placed a manual hold on the subscription, or ops suspended or deactivated the Hub workspace. It lifts automatically when a dunning suspension is paid.
  - `canceled`.
  - `expired`.

## §3. What Hub gives you: the contract
**Base URL:** `HUB_BASE_URL` + `/api/partners/v1`.

**Headers on every request:**
- `X-Partner-Key: ppk_…`. A secret; store it only in env as `HUB_PARTNER_KEY`.
- `Content-Type: application/json`.

**Extra headers on every mutation:**
- `X-Partner-Actor: {"external_user_id":"…","email":"…","name":"…","role":"owner"}`. JSON describing the Fixorata user acting; it is recorded in Hub's audit log. Hub trusts your server to have authorized this user.
- `Idempotency-Key: <uuid>`. Reuse the same key when retrying the same user action. A replay returns the original response; the same key with a different body returns 409.

**Errors:** `{ "error": { "code", "message" } }`.
- `unauthorized` 401: missing, bad or revoked key.
- `forbidden_scope` 403: the subscription isn't a Fixorata product.
- `tenant_not_linked` 404.
- `not_found` 404: the subscription id isn't one of this tenant's.
- `validation_failed` 400.
- `rejected` 422: a business rule refused the request, e.g. changing add-ons on a closed subscription. The `message` is written to be shown to the owner.
- `workspace_locked` 409: suspended or inactive in Hub, so the mutation is refused.
- `idempotency_conflict` 409.
- `payment_provider_error` 502: retry later. A declined card returns Stripe's own message.
- `internal_error` 500: retry later.

Handle all of them in the UI with friendly messages.

**Endpoints:**

| Method & path | Body → response |
|---|---|
| `GET /tenants/:ext/billing` | → `BillingSummary` (below) |
| `GET /tenants/:ext/invoices?limit=50&offset=0` | → `{ invoices: Invoice[], next_offset? }`. `next_offset` is **omitted**, never `null`, on the last page. |
| `POST /tenants` | `{ external_tenant_id, name, owner: { email, name }, product_slug?, success_url, cancel_url? }` → 201 `{ hub_org_id, billing_status, payment_url }`. `product_slug` defaults to `fixorata`. Idempotent on `external_tenant_id` as well as the `Idempotency-Key`. If the org is already linked and nothing is owed, `payment_url` is `null`. |
| `POST /tenants/:ext/checkout` | `{ success_url, cancel_url?, product_slug? }` → `{ hub_org_id, billing_status, payment_url }`. Mints a fresh pay link for an unpaid start. After `canceled` or `expired` it starts a new subscription (reactivation). Returns `payment_url: null` when nothing is owed. |
| `PATCH /tenants/:ext` | `{ name?, billing_email?, billing_name? }` → `BillingSummary`. Keeps Hub's copy of the shop name and billing contact current. It updates the Hub workspace name, the Stripe customer, and where Hub's billing emails go; Hub logins are never changed. Call it when the owner renames the shop or changes the billing email. |
| `POST /tenants/:ext/portal-session` | `{ return_url }` → `{ url }`. A Stripe Billing Portal link for updating the card and billing details. It is single-use and short-lived, so mint it on click (with a fresh `Idempotency-Key`) and never store it. |
| `POST /tenants/:ext/subscriptions/:sid/items` | `{ changes: [{ component_id, quantity }] }`, where quantity 0 removes the add-on → `BillingSummary`. A recurring change is **prorated**: the difference for the rest of the period goes on the **next** invoice. A one-time add-on is invoiced and charged to the card on file at once. The base charge can't be changed here. |
| `POST /tenants/:ext/subscriptions/:sid/cancel` | `{ at_period_end?: true, reason? }` → `BillingSummary`. The default is to cancel at the period end: the shop stays `active` with `cancel_at_period_end: true` until then. `at_period_end: false` cancels immediately. Use it only for an owner who explicitly asks to stop now. |
| `POST /tenants/:ext/subscriptions/:sid/resume` | `{}` → `BillingSummary`. Undoes an `at_period_end` cancel. |

`success_url`, `cancel_url` and `return_url` must be on `https://fixorata.com` (or your staging origin, or `http://localhost:<port>` in dev). Hub refuses other origins.

**The pay link (`payment_url`):**
- It is valid for about 23 hours and single-purpose. Never store it; mint a new one with `POST /checkout` whenever the owner clicks.
- It shows the shop name, line items and amount due, then Stripe's card form. During a trial it shows "Add a card" with $0 due and the trial end date.
- After payment it redirects to `success_url`. "Cancel" returns to `cancel_url`.
- Activation arrives by webhook a few seconds after the redirect.

**`BillingSummary`:**
```jsonc
{
  "hub_org_id": "…", "external_tenant_id": "…",
  "billing_status": "active",                 // see §2
  "workspace_status": "active|suspended|inactive",
  "subscription": null | {                    // the Fixorata subscription (at most one live)
    "hub_subscription_id": "…", "product_slug": "fixorata", "product_name": "Fixorata",
    "plan_key": "standard|custom",            // custom = a negotiated price (multi-store shops)
    "status": "incomplete|trialing|active|past_due|suspended|canceled|expired",
    "trial_ends_at": "ISO|null", "current_period_end": "ISO|null",
    "cancel_at_period_end": false, "canceled_at": "ISO|null",
    "suspension": null | { "source": "dunning|manual", "since": "ISO", "note": "…|null" },
    "monthly_total_cents": 3500,              // 0 when the subscription is closed: render the state, not "$0 / month"
    "items": [{ "id": "…", "component_id": "…", "name": "Subscription",
                "role": "base|addon", "kind": "one_time|recurring",
                "interval": "month|year|null", "interval_count": 1,
                "unit_amount_cents": 3500, "quantity": 1,
                "status": "pending|active|paid|canceled" }],
    "addon_options": []   // none today; shape: { component_id, name, kind, interval, unit_amount_cents, current_quantity }
  },
  "payment_method": null | { "type": "card|link|us_bank_account|…", "brand": "visa|null", "last4": "4242|null",
                             "exp_month": 12, "exp_year": 2028, "label": "Visa •••• 4242" },   // card fields null unless type is card
  "collection_method": "charge_automatically|send_invoice|null",   // null when nothing is live (canceled/expired)
  "next_charge": null | { "date": "ISO", "amount_cents": 3500 },
  "invoices": [ /* latest 20 Invoice */ ]
}
// Invoice
{ "id": "…", "number": "PW-0042", "status": "draft|open|paid|failed|void",
  "amount_due_cents": 3500, "amount_paid_cents": 0,
  "created_at": "ISO", "due_date": "ISO|null", "paid_at": "ISO|null",
  "period_start": "ISO|null", "period_end": "ISO|null",
  "hosted_invoice_url": "https://invoice.stripe.com/…|null",   // "Pay" when open/failed
  "invoice_pdf_url": "https://…|null" }
```

**Webhooks Hub sends you.** All of them are `POST`s to `HUB_WEBHOOK_URL`, the URL you give the user (e.g. `https://fixorata.com/api/webhooks/plaidware-hub`).

*Headers:*
- `X-Plaidware-Event`: the event name.
- `X-Plaidware-Delivery`: a uuid that stays the same across retries.
- `X-Plaidware-Timestamp`: unix seconds.
- `X-Plaidware-Signature`: `sha256=` + hex(HMAC-SHA256(`HUB_WEBHOOK_SECRET`, `${timestamp}.${rawBody}`)).

*Verifying a delivery:*
- Compute the HMAC over the **raw** body bytes, before JSON parsing.
- Compare with `crypto.timingSafeEqual`.
- Reject anything with a timestamp older than 5 minutes.
- **Never accept unsigned requests** in staging or prod. Fail closed when `req.rawBody` is missing (A.9).
- The timestamp and signature are **re-stamped on every retry**, so the 5-minute window never rejects a legitimate retry (§7 B.2).

*Events:*
- `provision.requested` (flat body):
  - Body: `{ hub_subscription_id, hub_org_id, product_slug, org_name, org_slug, owner_email, owner_name, external_tenant_id? }`.
  - Reply 2xx with `{ "external_tenant_id": "<your org id>", "portal_url": "https://fixorata.com" }`.
  - If `external_tenant_id` is present, link that existing org; never create a duplicate. Otherwise create the org and invite the owner.
  - Must be idempotent on `hub_subscription_id`: a repeat returns the same org id.
  - Hub waits **10 seconds** for the reply. Create the org row and reply at once, then finish seeding after replying (§7 B.8).
  - **A Hub-first shop's `subscription.activated` arrives before this handshake** and carries no `external_tenant_id`, so ignoring it is correct. Once Hub has read your reply and recorded the link, it sends a fresh `subscription.updated` that carries your id and the current state, and the mirror converges through that. Don't depend on pulling `GET /billing` right after replying: Hub writes the link only after reading your reply, so an immediate pull can get `tenant_not_linked`. If you pull, retry on that error (§7 B.19).
  - **Always include `external_tenant_id`**, in duplicate replies too. A 2xx without it is retried until it dead-letters (§7 B.20).
  - Generate your own org slug; never use Hub's `org_slug` (A.11).
  - Any non-2xx response, or a 2xx without `external_tenant_id`, is retried.
- Lifecycle events: `subscription.activated|updated|past_due|suspended|canceled|expired`.
  - Body: `{ "event": "...", "data": { hub_subscription_id, hub_org_id, external_tenant_id, product_slug, status, billing_status, plan_key, current_period_end, trial_ends_at, cancel_at_period_end, canceled_at, suspension_source, card_on_file, occurred_at, addon_components: [{ name, quantity }] } }`.
  - `suspension_source` is `"dunning"`, `"manual"` or `null` (not suspended). `card_on_file` is a boolean; `null` means Hub couldn't ask Stripe, so keep your prior value. `canceled_at` is the actual end time of a canceled subscription.
  - Upsert `billing_status`, `billing_plan` (from `plan_key`) and `billing_status_at` (from `occurred_at`) on the org. **Ignore any event whose `occurred_at` is older than the stored `billing_status_at`.**
  - `subscription.updated` fires often: renewals, period-end cancel and resume, Hub workspace holds. Delivery is at-least-once and can arrive out of order; `occurred_at` makes that safe.
- `organization.updated`: `{ hub_org_id, name, slug }`. Optional; you may ignore it.

*How to respond:*
- 2xx with `{"status":"processed"|"ignored"|"duplicate"}`. A delivery id you've already seen gets `duplicate`; an unknown event or org gets `ignored`.
- 5xx means "retry me". Hub retries at 1m, 5m, 30m, 2h and 12h, then dead-letters the delivery for ops.
- 410 permanently disables that delivery.

## §4. What to build in Fixorata (in this order)
Follow the review's §E plan, steps 0–9, with these decisions applied:
- **Access (A.2–A.6):** keep `enforceOrgWritable`, `resolveOrgAccess`, the kill switch (`platform_settings` plus `BILLING_ENFORCEMENT=off` force-off) and `ORG_READ_ONLY`. There are only two tiers, full and read-only, and **never a lockout**. Use the mapping table in A.3, with `none` = an implicit 30-day trial from `created_at` (A.4). Add a row for Hub workspace holds: they arrive as `suspended`, so read-only.
- **Schema (A.7, A.8):** additive only. `billing_status` and `billing_plan` are TEXT with a TypeScript union, plus `billing_status_at`, `hub_org_id`, `billing_exempt` and `hub_webhook_events`. Drop no tables, and annotate `organizations.status` as ORPHANED.
- **Owner-only billing (A.13):** managers don't see the billing page or the price. Only the owner calls `/billing/*`, with platform admin and support reading through the admin console.
- **Plan rules (A.17):** enforce the one-store cap when `billing_plan` is `standard`, and lift it when `custom`. Read the mirrored value, never `monthly_total_cents`.
- **Provisioning (A.11):** extract `provisionTenant()` and use it for both onboard-tenant and `provision.requested`. Reply to Hub fast.
- **Audit (A.12):** create a real `users` row, "Plaidware Hub", as the actor for webhook-driven audit rows.
- **Actor header (A.18):** pick `id`, `email` and the name explicitly from `req.user`, plus the **real** membership role.
- **Idempotency (A.19):** the client mints the key when the button renders and renews it after each settled attempt; any retry reuses it.
- **Sign-up hook (D, §E step 7):** call `POST /tenants` right after creating the org. It's best-effort: on failure leave `none`, and `GET /billing` retries while `hub_org_id` is null.
- **Name and email changes:** call `PATCH /tenants/:ext` whenever the owner renames the shop or changes the billing email (B.6).
- **Email return path (A.16):** add a return-to on `/auth`, honor `?org=` on `/billing`, and fix known-issue 18.5.
- **Trial UI:** show "Your free trial ends on … — add a card" while `trialing` with no `payment_method`. When `expired`, show read-only with "Add a card to continue", which calls `/start`.
- **Add-ons:** render only when `addon_options` is non-empty (none today).
- **Mock (A.24):** `server/hub-mock.ts` refuses to load when `NODE_ENV === "production"`.

## §5. Rules
- Never store prices, invoices or cards locally. Fetch them live. The mirror holds only access and display state, all from lifecycle `data`: `billing_status`, `billing_plan`, `billing_status_at`, `hub_org_id`, `trial_ends_at`, `current_period_end`, `cancel_at_period_end`, `canceled_at`, `card_on_file` (a boolean, never the card) and `suspension_source`. `/access` reads only the mirror (A.15).
- Never compute money in Fixorata. Display the cents Hub returns, formatted as USD.
- The partner key and webhook secret are server-only, live in Railway variables, and must never be committed.
- Use staging Hub with staging Fixorata and prod with prod. Stripe on Hub staging is in test mode (card 4242 4242 4242 4242). The staging `APP_URL` must be the staging origin (A.20).
- Follow fixorata's CLAUDE.md (local → develop → main, no commits unless asked).
- Contract questions or mismatches: write them down in `docs/integrations/plaidware-hub-deviations.md` and tell the user. Don't work around them silently.

## §6. Testing
- **Before Hub staging is live,** build against a local mock: `server/hub-mock.ts`, enabled by `HUB_BASE_URL=mock`. It returns the fixtures in §3 for each `billing_status`, and a script signs sample webhooks with a test secret.
- **Unit tests:** signature verification (valid, tampered, stale, unsigned), `decideAccess` across the full status × method matrix, and the webhook handlers' idempotency.
- **Against Hub staging** (the user supplies the key and secret):
  1. Fixorata-first: sign up. The shop is `trialing` with no card and no redirect, the summary shows $35/month and `trial_ends_at` 30 days out, and `addon_options` is empty.
  2. Add a card during the trial with test card 4242 on the pay page. `payment_method` shows 4242 and the status stays `trialing`. A no-card trial running past its end (→ `subscription.expired`, then read-only) is verified on Hub's side with Stripe test clocks. Fixorata can't fast-forward a trial, so test the `expired` webhook with the mock's signed sample.
  3. Update the card via the portal.
  4. Cancel at period end, then resume.
  5. Hub-first: ops start a Fixorata subscription in Hub, and an org appears in Fixorata.
  6. Link existing: ops paste the org id, and the status syncs.
  7. Dunning: use test card 4000 0000 0000 0341 to fail a renewal, ops advance dunning, the shop goes read-only, paying the invoice lifts it.
  8. Reactivate: cancel now (`at_period_end: false`), then `/start`. You get a pay link for $35 now, with no new trial.

## §7. Hub's answers to the review (2026-10-18)
**Accepted as written:** A.1–A.24 and the E plan, with the decisions in §4.

**Decided by the product owner:**
- **A.3 and A.4:** read-only, never a lockout, and `none` = an implicit trial.
- **A.13:** billing stays owner-only.
- **A.14:** the landing page keeps "$35 per month".
- **B.4:** a trial that ends without a card **expires** (read-only), with no invoice and no dunning.
- **C:** the rollout plan below.
- **D:** the trial starts at org creation.

**B. Contract questions:**
1. **Plan identifier.** Added. `plan_key` is in `BillingSummary.subscription` and in lifecycle `data`. It is `custom` when the shop has a negotiated price on the base charge; ops set that when they agree a multi-store price. Otherwise it is `standard`.
2. **Retry timestamps.** Each attempt is re-signed with a fresh `X-Plaidware-Timestamp`, and the delivery id stays the same.
3. **Event ordering.** Added `occurred_at` (when Hub emitted the event), `trial_ends_at` and `cancel_at_period_end` to lifecycle `data`.
4. **Trial end without a card.** Changed (see v0.97). Stripe ends the subscription at the trial end with no invoice, and Hub maps it to `expired`. Verified on Stripe test clocks.
5. **`workspace_status: inactive`.** Hub now folds workspace holds into `billing_status` (`suspended`, so read-only) and announces them with `subscription.updated`. Read `billing_status` only; `workspace_status` is informational.
6. **Pushing changes to Hub.** Added `PATCH /tenants/:ext`. Hub keeps one billing contact per shop; send whichever owner should receive billing emails.
7. **Email links.** Done. They point to `{your billing URL}?org=<external_tenant_id>`. Plaidware sets the URL in Hub as `https://fixorata.com/billing`, and the staging one for staging.
8. **Provisioning timeout.** Hub waits 10 seconds. Reply first, seed after. A timeout is retried with the same delivery id, so the handler must stay idempotent.
9. **Linking existing shops on their real terms.** Supported. Ops link the shop on Hub's Client → Provisioning tab **first**, then use "Start subscription" with the negotiated price, no trial, and emailed invoices or a card. The activation handshake then carries your org id, and you link it.
10. **Rate limits.** There are none on the Partner API today. Polling `GET /billing` every 2 seconds for about 30 seconds after a payment is fine.
11. **Key rotation.** Several keys can be active at once: Hub mints the new key, you deploy it, Hub revokes the old one. The webhook secret has no overlap window, but Hub retries for about 15 hours after a rotation, so update the env within that window.
12. **`trial_ends_at` is an instant.** Agreed; showing it as a store-local date is right.
13. **`pending`.** Lifecycle webhooks only carry it after reactivation. A `GET` can show `pending` for a linked shop whose Hub-side start awaits its first payment; treat it as "no change".

**C. Production rollout (agreed):**
- **EZ Wireless:** ops link it in Hub at $35/month, no trial, billed by emailed invoice. The owner is told before the change.
- **The Fix (Adeel):** ops link it at its custom $60/month, no trial. Export that price from production first.
- **iFixIT:** a fresh 30-day trial through `POST /tenants`.
- **Test Repair Shop:** `billing_exempt` and never linked. Staging test orgs are exempt too.
- **Order:** deploy with enforcement off → link the shops → check the admin table → turn enforcement on.

**B.14–B.18 (from step 2):**

14. **`collection_method` is nullable.** It's `null` whenever nothing is live (canceled or expired). The brief now says so.
15. **Fixture wrapping.** Fixed: every response fixture is `{ status, body }`.
16. **`next_offset`.** It is omitted, never `null`, on the last page. The re-export has both cases (`invoices--page.json` has it, `invoices--last-page.json` doesn't).
17. **`/checkout` on a suspended or past-due shop.** Never a 409; it depends on why the shop is held:
    - **`past_due`, or `suspended` by dunning:** Hub returns a `payment_url` to its pay page for the **open invoice**. Paying there returns the owner to your `success_url` and clears dunning. Prefer it over `hosted_invoice_url` for "Pay now", since Stripe's hosted invoice page has no way back. Recorded in `post-checkout--past-due-pay.json`.
    - **`suspended` by an ops manual hold:** `payment_url: null`. Only Plaidware lifts it, so show "Contact Plaidware" (`post-checkout--suspended-manual-hold.json`). The summary's `subscription.suspension.source` (`dunning` | `manual`) tells the two apart.
18. **Closed subscriptions.** `items` now lists the plan as it was for both canceled and expired, and `monthly_total_cents` is `0`. Render the state (and what reactivating costs, from `items`), never "$0 / month". `trial_ends_at` stays as history.

**From step 3's review (v0.99):**

19. **Hub-first activation race.** Fixed on Hub's side. When a provision reply creates the link, Hub immediately queues `subscription.updated` with `external_tenant_id` and the current `billing_status`, `plan_key` and `occurred_at`. The receiver needs nothing new: it mirrors that event like any other. A post-reply pull is optional; if you keep it, retry `tenant_not_linked` with a short backoff.
20. **Duplicate provision without an org id.** In `server/hub-webhook.ts`, a seen delivery whose stored row has no `externalTenantId` answers `{"status":"duplicate"}` with no `external_tenant_id`. Hub treats that as "not done" and retries for about 15 hours. Either look up the org by `hub_subscription_id` or `hub_org_id` and reply with its id, or answer 5xx while it's genuinely unknown.

**From step 4's review (your deviations 19–21, v1.0-rc):**

- **19, the display mirror:** accepted. It holds no price, invoice or card detail. Hub now sends `card_on_file` and `suspension_source` in **every** lifecycle event, so they no longer depend on a `GET` sync. Update them from events. `card_on_file: null` means "unknown", so keep the old value. Clear `suspension_source` whenever the event's value is `null`. Keep the `GET` sync as a refresh.
  - **Card events:** adding a card mid-trial reaches you as `subscription.updated` (`card_on_file: true`), sent when Stripe attaches it to the subscription.
  - **Portal limitation:** changing the card only at the customer level in the Billing Portal doesn't emit an event. That case still relies on your `GET` refresh after the portal returns.
- **20, transitional adapter:** fine. Make sure step 8 removes it.
- **21, end dates:** right that `trialing` never expires by the clock, since Hub owns the transition. For "ended on", Hub now sends `canceled_at`. Use it. Fall back to `current_period_end` and then `occurred_at` only when it's `null`.

**From step 5's review (your B.22, v1.0-rc2):**

- **Deep link.** Hub's per-client console is `{HUB_BASE_URL}/ops/clients/<hub_org_id>` (staging: `https://hub-staging.plaidware.com/...`). This is a stable route. Tabs append `/billing`, `/provisioning` or `/activity`; link the Billing tab from the admin table. Viewers must be Plaidware ops signed in to Hub.
- **(a) Actor role.** Hub records any `role` string up to 50 characters, for audit only. `platform_admin` is fine, and so is any other real role.
- **(b) Idempotency across routes.** Hub keys the ledger on (app, key) and compares method, path and body, so reusing one key on a different route is a 409 by design. Scope the key per route when forwarding (for example `<clientKey>:tenants` and `<clientKey>:checkout`). The same button retry then replays correctly whichever route it reaches.
- **Rollout guard (new, step 6).** An org still resolved through its legacy row (your deviation 20 adapter, i.e. EZ Wireless and The Fix until ops link them) must **not** show "Start subscription". Show "Plaidware is moving your billing to the new system" instead. If the owner clicked Start first, Hub would create a fresh $35 trial tenant, and ops could no longer link the shop at its agreed terms (§7 C). Once ops link and start it in Hub, the webhook fills the mirror and the normal UI takes over.

**From the staging walkthrough (your B.23, v1.0-rc3):**

- **The pay-page card was missing from `GET /billing`.** This was a Hub bug, now fixed. The owner saved the card through **Stripe Link**, which Stripe's form offers, so the default payment method was type `link`, not `card`. Hub's summary only described cards and returned `null`. The webhook's `card_on_file` was right all along. That `null` also hid `next_charge`.
- **Changed contract shape.** `payment_method` is now `{ type, brand, last4, exp_month, exp_year, label }`. `brand`, `last4` and the expiry are `null` unless `type` is `card`. Show `label`, which is ready-made text such as "Visa •••• 4242", "Link (owner@…)" or a bank account. Update your schema; the re-exported fixtures carry the new shape.
- **Your fixes 1–4.** Agreed, especially fix 1: only Hub's `occurred_at` may move the ordering marker, never a sync.

**B.24 (dates near midnight):** keep showing the **store-local** date. Hub's timestamps are instants; the charge at 01:32 UTC on 18 Nov really happens on the evening of 17 Nov for a Central-time shop. Hub's own emails print dates in Central time, so they agree for Central shops. A shop in another time zone may see a one-day difference between a Hub email and the app around midnight, which is acceptable. No contract change.
