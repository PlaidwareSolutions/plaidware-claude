# MHub Integration — Deviations & Clarifications

Reconciliation notes for the Hub↔MHub contract (session introspection,
lifecycle webhooks, provisioning handshake, partner feed). "Deviation" =
differs from the written contract; "clarification" = contract was silent,
Hub picked a behavior MHub should be aware of.

## Deviations

1. **`addon_components[].quantity` is the summed item quantity per name.**
   `subscription_items.quantity` (billing v2, 2026-09) is passed to Stripe as
   the item quantity; ops can start a subscription with "Extra Location ×2" in
   one purchase. Legacy multiples (duplicate rows from before the column
   existed) still aggregate by component name, so `quantity` is ≥1 either way.

## Clarifications

2. **Provision handshake `X-Plaidware-Event` header is `provision.requested`.**
   §C says "same signature scheme as B" but names no event; MHub routes by
   URL, so the header value is informational.

3. **Trials count as activation.** A `marketing-*` subscription entering
   `trialing` emits `subscription.activated` (and triggers the handshake);
   the payload's `status` field carries the literal status (`trialing`), so
   MHub can distinguish. Trial→active later emits `subscription.updated`.

4. **Roster replay on first activation.** Org/membership events only fire for
   orgs with a live `marketing-*` subscription, so members who joined before
   the first activation would never be announced. On the first
   `subscription.activated` (with the handshake), Hub emits
   `membership.changed` (`action: "added"`) for every current member. MHub
   must upsert by `(hub_org_id, hub_user_id)` — these can duplicate later
   events.

5. **Partner feed pagination.** Responses over the page size include a
   `next_offset` field; pass it back as `?offset=`. Page size is capped at
   500 (`?limit=` accepted up to 500). Ordering is stable
   (`created_at, id`), and all statuses (including `canceled`/`expired`)
   are returned so MHub can reconcile terminal states.

6. **`subscription.updated` is emitted liberally.** Any Stripe-driven update
   on a live subscription (period end moved, add-on reconciliation) emits
   `subscription.updated`, not just add-on changes. Delivery is
   at-least-once; MHub should treat payloads as idempotent upserts keyed on
   `hub_subscription_id`.

7. **`organization.updated` currently has no Hub-side trigger UI.** Hub has
   no org rename surface today; the event fires if/when orgs are updated via
   Better Auth's organization endpoints (hooked), and the plumbing is ready
   for a rename feature.

## Resolutions (contract, confirmed by both sides)

- **`portal_url` is generic and permanently stable** (resolved 2026-08-26,
  mirrored in MHub's resolutions log): the handshake returns
  `{MHUB_BASE_URL}/portal` for every tenant — the portal resolves the tenant
  from the Hub session (multi-org users get a workspace switcher). MHub
  commits to never requiring per-tenant URLs; Hub displays the stored value
  verbatim indefinitely and no backfill of `subscription_provisioning`
  rows will ever be needed.
- **Phase 2 receiver semantics** (verified in the 2026-08-26 E2E, driven by
  `scripts/e2e-mhub.ts`): 2xx bodies are `{"status":"processed"|"ignored"|
  "duplicate"}`; unknown event names and unknown orgs ACK as ignored (never
  4xx); a replayed `X-Plaidware-Delivery` uuid returns duplicate without
  reprocessing; 5xx means retry; provision is fully idempotent.
