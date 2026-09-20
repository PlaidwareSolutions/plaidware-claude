import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "../../db";
import { env } from "../../env";
import { auth } from "../../lib/auth";
import { getStripe } from "../../lib/stripe";
import { emailButton, emailShell, sendEmail } from "../../lib/email";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { formatCents } from "../../lib/money";
import { normalizePhone, PLACEHOLDER_PHONE } from "../../lib/phone";
import { account, organization, user } from "../auth/schema";
import { productComponents, products } from "../catalog/schema";
import { subscriptions, tenantPriceOverrides } from "../billing/schema";
import { isRecurringKind, LIVE_SUBSCRIPTION_STATUSES } from "../billing/mappers";
import { createCheckout, promoteDefaultPaymentMethod } from "../billing/service";
import { setTenantPriceOverride } from "../billing/ar-service";
import { createTenantWithOwner, uniqueSlug } from "../tenancy/service";
import { getUserTenants } from "../tenancy/queries";
import { setDomain } from "../provisioning/service";
import { subscriptionProvisioning } from "../provisioning/schema";
import { writeAudit } from "../audit/service";
import { emitSubscriptionLifecycle } from "../webhooks_out/service";
import { onboardingInvites } from "./schema";
import { needsPasswordSetup } from "./setup-rules";
import {
  buildProductProposal,
  combineTotals,
  entryComponentIds,
  entryPriceMap,
  pickPrimaryIndex,
  type InviteProductEntry,
  type ProposalProduct,
} from "./proposal";
import { AUTH } from "@/lib/routes";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const INVITE_DAYS = 14;
/** Keep a resendable copy of the raw token when the at-rest key is configured (staging/prod are). */
const sealToken = (raw: string): string | null => (env.CREDENTIALS_ENCRYPTION_KEY ? encryptSecret(raw) : null);

// ---------------------------------------------------------------------------
// Ops: prepare everything, get one link
// ---------------------------------------------------------------------------

export async function createClientSetup(opts: {
  clientName: string;
  clientEmail: string;
  /** Any format; normalised to E.164. Missing → placeholder flagged on the People tab. */
  phone?: string | null;
  tenantName: string;
  /** Locked per-product selections; priceCents null = list price. */
  products: {
    productId: string;
    items: { componentId: string; priceCents: number | null }[];
    domainUrl?: string | null;
  }[];
  sendEmailToClient: boolean;
  actorUserId: string;
}): Promise<{ link: string; inviteId: string; tenantId: string; superseded: number; emailError: string | null }> {
  const email = opts.clientEmail.trim().toLowerCase();
  if (opts.products.length === 0) throw new Error("Pick at least one product");
  const productIds = opts.products.map((p) => p.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw new Error("Each product can appear only once");
  }

  // Every component must belong to the product it's claimed under.
  const allItemIds = opts.products.flatMap((p) => p.items.map((i) => i.componentId));
  const comps = allItemIds.length
    ? await db.query.productComponents.findMany({
        where: inArray(productComponents.id, allItemIds),
      })
    : [];
  for (const p of opts.products) {
    for (const item of p.items) {
      const comp = comps.find((c) => c.id === item.componentId);
      if (!comp || comp.productId !== p.productId) {
        throw new Error("Component does not belong to the selected product");
      }
    }
  }

  // 1. Find or create the client's account. A new row is inserted directly —
  //    signUpEmail would also mail a "confirm your email" link, and clicking
  //    that first used to break the set-password step. No credential account
  //    exists until the client chooses a password on the welcome page.
  let clientUser = await db.query.user.findFirst({ where: eq(user.email, email) });
  if (!clientUser) {
    const [first, ...rest] = opts.clientName.trim().split(/\s+/);
    const now = new Date();
    [clientUser] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: opts.clientName.trim(),
        email,
        emailVerified: false,
        firstName: first || "Client",
        lastName: rest.join(" ") || "-",
        phone: normalizePhone(opts.phone) ?? PLACEHOLDER_PHONE,
        platformRole: "customer",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  } else if (opts.phone && normalizePhone(opts.phone) && clientUser.phone === PLACEHOLDER_PHONE) {
    await db.update(user).set({ phone: normalizePhone(opts.phone)! }).where(eq(user.id, clientUser.id));
  }

  // 2. Find their owned tenant, else create one.
  const memberships = await getUserTenants(clientUser.id);
  const owned = memberships.find((m) => m.role === "owner");
  const tenantId = owned
    ? owned.id
    : (
        await createTenantWithOwner({
          name: opts.tenantName.trim(),
          slug: await uniqueSlug(opts.tenantName),
          ownerUserId: clientUser.id,
        })
      ).id;

  // 3. Custom prices are held on the invite and become tenant overrides only
  //    when the client commits (applyInvitePricing) — a link that is never
  //    used leaves no pricing behind, and a price can't land on the wrong
  //    product because it is tied to the invite's own product entry.
  const raw = randomBytes(24).toString("hex");
  const entries: InviteProductEntry[] = opts.products.map((p) => ({
    productId: p.productId,
    items: p.items.map((i) => {
      const comp = comps.find((c) => c.id === i.componentId);
      return {
        componentId: i.componentId,
        priceCents: i.priceCents == null || i.priceCents === comp?.amountCents ? null : i.priceCents,
      };
    }),
    domainUrl: p.domainUrl?.trim() || null,
  }));
  const [invite] = await db
    .insert(onboardingInvites)
    .values({
      tokenHash: sha256(raw),
      tokenEnc: sealToken(raw),
      tenantId,
      userId: clientUser.id,
      products: entries,
      createdByUserId: opts.actorUserId,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    })
    .returning();

  // One open setup link per client and product: an older pending link that
  // covers any of these products is superseded, so the client never holds two
  // live tokens for the same purchase and the Clients list never shows twins.
  const openOthers = await db.query.onboardingInvites.findMany({
    where: and(eq(onboardingInvites.tenantId, tenantId), eq(onboardingInvites.status, "pending")),
  });
  const supersededIds = openOthers
    .filter((o) => o.id !== invite.id && o.products.some((e) => productIds.includes(e.productId)))
    .map((o) => o.id);
  if (supersededIds.length) {
    await db
      .update(onboardingInvites)
      .set({ status: "revoked" })
      .where(inArray(onboardingInvites.id, supersededIds));
    await db.delete(tenantPriceOverrides).where(inArray(tenantPriceOverrides.sourceInviteId, supersededIds));
    await writeAudit({
      tenantId,
      actorUserId: opts.actorUserId,
      kind: "client_setup_revoked",
      payload: { inviteIds: supersededIds, supersededBy: invite.id },
    });
  }

  await writeAudit({
    tenantId,
    actorUserId: opts.actorUserId,
    kind: "client_setup_created",
    payload: {
      products: opts.products.map((p) => ({ productId: p.productId, items: p.items.length })),
      email,
      superseded: supersededIds.length,
    },
  });

  const link = `${env.APP_BASE_URL}${AUTH.welcome(raw)}`;

  // The link must still reach ops when mail is down, so a send failure is
  // returned alongside it rather than thrown.
  let emailError: string | null = null;
  if (opts.sendEmailToClient) {
    try {
      await sendSetupLinkEmail(invite.id, link);
    } catch (e) {
      emailError = e instanceof Error ? e.message : "Email failed";
    }
  }

  return { link, inviteId: invite.id, tenantId, superseded: supersededIds.length, emailError };
}

/** The "your setup is ready" email — at creation, on regenerate, and on resend. Throws when mail is configured but failed. */
export async function sendSetupLinkEmail(inviteId: string, link: string): Promise<string | null> {
  const proposal = await assembleProposal(inviteId);
  if (!proposal) return null;
  const names = proposal.products.map((p) => p.productName).join(" + ");
  const r = await sendEmail({
    to: proposal.clientEmail,
    subject: "Your Plaidware setup is ready",
    html: emailShell(
      `Welcome, ${proposal.clientName.trim()}`,
      `<p>Your ${names ? `${names} ` : ""}services are configured and ready to activate. One step: open the link below, ${proposal.needsPassword ? "choose a password, " : "sign in, "}and complete payment.</p>` +
        `<p><strong>Due today: ${formatCents(proposal.dueTodayCents)}</strong>${proposal.monthlyCents ? ` · then ${formatCents(proposal.monthlyCents)}/mo` : ""}${proposal.yearlyCents ? ` + ${formatCents(proposal.yearlyCents)}/yr` : ""}</p>` +
        (proposal.products.length > 1
          ? `<p style="color:#8b93b2;font-size:13px">Your card will be charged separately for each service — ${proposal.products.length} charges totaling ${formatCents(proposal.dueTodayCents)} today.</p>`
          : "") +
        emailButton(link, "Complete your setup") +
        `<p style="color:#8b93b2;font-size:13px">This link is personal to you and expires in ${INVITE_DAYS} days.</p>`,
    ),
  });
  if (!r.sent && env.RESEND_API_KEY) throw new Error(`Email to ${proposal.clientEmail} failed: ${r.error}`);
  return proposal.clientEmail;
}

/**
 * Re-send the SAME link (no rotation): the email already in the client's
 * inbox keeps working. Needs the stored token copy; legacy rows regenerate.
 */
export async function resendSetupLink(inviteId: string, actorUserId: string): Promise<{ sentTo: string }> {
  const invite = await db.query.onboardingInvites.findFirst({ where: eq(onboardingInvites.id, inviteId) });
  if (!invite) throw new Error("Setup link not found");
  if (invite.status !== "pending" || invite.expiresAt < new Date()) throw new Error("This link has expired — regenerate it");
  if (!invite.tokenEnc) throw new Error("This link predates resend support — regenerate it");
  const raw = decryptSecret(invite.tokenEnc);
  const link = `${env.APP_BASE_URL}${AUTH.welcome(raw)}`;
  const sentTo = await sendSetupLinkEmail(inviteId, link);
  if (!sentTo) throw new Error("Setup link not found");
  await writeAudit({
    tenantId: invite.tenantId,
    actorUserId,
    kind: "client_setup_resent",
    payload: { inviteId, email: sentTo },
  });
  return { sentTo };
}

// ---------------------------------------------------------------------------
// Client: proposal assembly + token resolution
// ---------------------------------------------------------------------------

export type SetupProposal = {
  inviteId: string;
  status: string;
  clientName: string;
  clientEmail: string;
  tenantId: string;
  tenantName: string;
  needsPassword: boolean;
  products: ProposalProduct[];
  /** Index of the product paid interactively (its payment saves the card). */
  primaryIndex: number;
  dueTodayCents: number;
  monthlyCents: number;
  yearlyCents: number;
};

async function assembleProposal(inviteId: string): Promise<SetupProposal | null> {
  const invite = await db.query.onboardingInvites.findFirst({
    where: eq(onboardingInvites.id, inviteId),
  });
  if (!invite || invite.products.length === 0) return null;
  const allComponentIds = invite.products.flatMap(entryComponentIds);
  const [clientUser, credential, productRows, comps, overrides, org] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, invite.userId) }),
    db.query.account.findFirst({
      where: and(eq(account.userId, invite.userId), eq(account.providerId, "credential")),
      columns: { password: true },
    }),
    db.query.products.findMany({
      where: inArray(products.id, invite.products.map((p) => p.productId)),
    }),
    allComponentIds.length
      ? db.query.productComponents.findMany({
          where: inArray(productComponents.id, allComponentIds),
        })
      : Promise.resolve([]),
    db.query.tenantPriceOverrides.findMany({
      where: eq(tenantPriceOverrides.tenantId, invite.tenantId),
    }),
    db.query.organization.findFirst({
      where: eq(organization.id, invite.tenantId),
    }),
  ]);
  if (!clientUser || productRows.length !== invite.products.length) return null;

  const overrideAmounts = new Map(overrides.map((o) => [o.componentId, o.amountCents]));
  const proposalProducts = invite.products.map((entry) => {
    const ids = entryComponentIds(entry);
    return buildProductProposal(
      entry,
      productRows.find((p) => p.id === entry.productId)?.name ?? "Product",
      comps.filter((c) => ids.includes(c.id)),
      overrideAmounts,
    );
  });
  const recurringIds = new Set(comps.filter((c) => isRecurringKind(c.kind)).map((c) => c.id));

  return {
    inviteId: invite.id,
    status: invite.status,
    clientName: clientUser.name,
    clientEmail: clientUser.email,
    tenantId: invite.tenantId,
    tenantName: org?.name ?? "your workspace",
    // Password step until the account has a password and a verified email.
    needsPassword: needsPasswordSetup({ emailVerified: clientUser.emailVerified, credentialPassword: credential?.password }),
    products: proposalProducts,
    primaryIndex: pickPrimaryIndex(invite.products, (id) => recurringIds.has(id)),
    ...combineTotals(proposalProducts),
  };
}

/**
 * Commit the invite's held prices as tenant overrides (tagged with the invite
 * so a later revoke/expiry can remove exactly these). Idempotent: rows that
 * already match are skipped, so finalize re-runs don't spam the audit log.
 */
export async function applyInvitePricing(inviteId: string, actorUserId: string | null): Promise<number> {
  const invite = await db.query.onboardingInvites.findFirst({ where: eq(onboardingInvites.id, inviteId) });
  if (!invite) throw new Error("Setup not found");
  const held = invite.products.flatMap((e) => [...entryPriceMap(e)]);
  if (held.length === 0) return 0;
  const existing = await db.query.tenantPriceOverrides.findMany({
    where: and(
      eq(tenantPriceOverrides.tenantId, invite.tenantId),
      inArray(tenantPriceOverrides.componentId, held.map(([id]) => id)),
    ),
  });
  let applied = 0;
  for (const [componentId, amountCents] of held) {
    const cur = existing.find((o) => o.componentId === componentId);
    if (cur && cur.amountCents === amountCents && cur.sourceInviteId === invite.id) continue;
    await setTenantPriceOverride({
      tenantId: invite.tenantId,
      componentId,
      amountCents,
      actorUserId: actorUserId ?? invite.createdByUserId ?? invite.userId,
      sourceInviteId: invite.id,
    });
    applied++;
  }
  return applied;
}

/** Daily: pending links past their expiry flip to expired and drop any price they held. */
export async function expirePendingInvites(now = new Date()): Promise<number> {
  const rows = await db
    .update(onboardingInvites)
    .set({ status: "expired" })
    .where(and(eq(onboardingInvites.status, "pending"), lt(onboardingInvites.expiresAt, now)))
    .returning({ id: onboardingInvites.id, tenantId: onboardingInvites.tenantId });
  for (const r of rows) {
    await db.delete(tenantPriceOverrides).where(eq(tenantPriceOverrides.sourceInviteId, r.id));
    await writeAudit({ tenantId: r.tenantId, kind: "client_setup_expired", payload: { inviteId: r.id } });
  }
  return rows.length;
}

export async function getSetupByToken(raw: string): Promise<SetupProposal | null> {
  const invite = await db.query.onboardingInvites.findFirst({
    where: eq(onboardingInvites.tokenHash, sha256(raw)),
  });
  if (!invite) return null;
  if (invite.status === "pending" && invite.expiresAt < new Date()) {
    await db
      .update(onboardingInvites)
      .set({ status: "expired" })
      .where(eq(onboardingInvites.id, invite.id));
    invite.status = "expired";
  }
  const proposal = await assembleProposal(invite.id);
  return proposal ? { ...proposal, status: invite.status } : null;
}

// ---------------------------------------------------------------------------
// Client: one-time password set (token possession = authorization)
// ---------------------------------------------------------------------------

export async function completeSetupPassword(raw: string, newPassword: string): Promise<void> {
  const invite = await db.query.onboardingInvites.findFirst({
    where: eq(onboardingInvites.tokenHash, sha256(raw)),
  });
  if (!invite || invite.status !== "pending" || invite.expiresAt < new Date()) {
    throw new Error("This setup link is no longer valid");
  }
  const clientUser = await db.query.user.findFirst({ where: eq(user.id, invite.userId) });
  if (!clientUser) throw new Error("Account not found");
  const credential = await db.query.account.findFirst({
    where: and(eq(account.userId, invite.userId), eq(account.providerId, "credential")),
    columns: { id: true, password: true },
  });
  if (!needsPasswordSetup({ emailVerified: clientUser.emailVerified, credentialPassword: credential?.password })) {
    throw new Error("Password already set — sign in with your existing password");
  }

  const ctx = await auth.$context;
  const hash = await ctx.password.hash(newPassword);
  const now = new Date();
  await db.transaction(async (tx) => {
    if (credential) {
      await tx.update(account).set({ password: hash }).where(eq(account.id, credential.id));
    } else {
      // Mirrors Better Auth's own credential account (accountId = userId).
      await tx.insert(account).values({
        id: crypto.randomUUID(),
        accountId: invite.userId,
        providerId: "credential",
        userId: invite.userId,
        password: hash,
        createdAt: now,
        updatedAt: now,
      });
    }
    await tx.update(user).set({ emailVerified: true }).where(eq(user.id, invite.userId));
  });
}

// ---------------------------------------------------------------------------
// Client: finalize — pay-once fan-out across every configured product
// ---------------------------------------------------------------------------

export type FinalizeState =
  | { state: "complete" }
  /** The client hasn't started (or finished creating) the primary checkout. */
  | { state: "awaiting_primary" }
  /** The primary exists but its payment hasn't settled (3DS / webhook lag). */
  | { state: "awaiting_payment" }
  /** Secondary charges need the client's help — recover on-session. */
  | {
      state: "pending";
      items: {
        productId: string;
        productName: string;
        status: "requires_action" | "requires_payment";
        clientSecret: string;
      }[];
    };

const SETTLED = ["active", "trialing"];

/**
 * Idempotent, re-runnable completion: once the primary product's payment has
 * settled (saving the card), create + auto-charge the remaining products'
 * subscriptions off-session, attach per-product domains, and accept the
 * invite when everything is live. Safe to call on every page mount and from
 * the invoice.paid webhook — money only ever moves via invoices.pay AFTER a
 * subscription row has won its unique (tenant, product) slot.
 */
export async function runFinalize(inviteId: string): Promise<FinalizeState> {
  const invite = await db.query.onboardingInvites.findFirst({
    where: eq(onboardingInvites.id, inviteId),
  });
  if (!invite || invite.products.length === 0) throw new Error("Setup not found");
  if (invite.status === "accepted") return { state: "complete" };
  if (invite.status === "revoked") throw new Error("This setup link was revoked");
  // `expired` proceeds only when the primary was already paid (money moved —
  // honor it); an untouched expired invite stays dead.

  // The held prices must exist as overrides before any checkout in this run
  // reads them (the primary checkout applies them too; this covers webhooks).
  await applyInvitePricing(invite.id, null);

  const entries = invite.products;
  const entryProductIds = entries.map((e) => e.productId);
  const [subs, productRows, comps, clientUser, org] = await Promise.all([
    db.query.subscriptions.findMany({
      where: and(
        eq(subscriptions.tenantId, invite.tenantId),
        inArray(subscriptions.productId, entryProductIds),
        inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES),
      ),
    }),
    db.query.products.findMany({ where: inArray(products.id, entryProductIds) }),
    db.query.productComponents.findMany({
      where: inArray(productComponents.id, entries.flatMap(entryComponentIds)),
    }),
    db.query.user.findFirst({ where: eq(user.id, invite.userId) }),
    db.query.organization.findFirst({ where: eq(organization.id, invite.tenantId) }),
  ]);
  if (!clientUser) throw new Error("Account not found");

  const subFor = (productId: string) => subs.find((s) => s.productId === productId);
  const recurringIds = new Set(comps.filter((c) => isRecurringKind(c.kind)).map((c) => c.id));
  const primary = entries[pickPrimaryIndex(entries, (id) => recurringIds.has(id))];

  const primarySub = subFor(primary.productId);
  if (!primarySub) {
    if (invite.status !== "pending") throw new Error("This setup link is no longer valid");
    return { state: "awaiting_primary" };
  }
  if (!SETTLED.includes(primarySub.status)) return { state: "awaiting_payment" };

  // Resolve the card saved by the primary payment. The list fallback absorbs
  // save/webhook timing right after confirmation.
  const stripe = getStripe();
  let pm: string | null = null;
  if (org?.stripeCustomerId) {
    if (primarySub.stripeSubscriptionId) {
      const stripeSub = await stripe.subscriptions.retrieve(primarySub.stripeSubscriptionId);
      pm =
        typeof stripeSub.default_payment_method === "string"
          ? stripeSub.default_payment_method
          : (stripeSub.default_payment_method?.id ?? null);
    }
    if (!pm) {
      const customer = (await stripe.customers.retrieve(
        org.stripeCustomerId,
      )) as import("stripe").Stripe.Customer;
      pm =
        typeof customer.invoice_settings?.default_payment_method === "string"
          ? customer.invoice_settings.default_payment_method
          : (customer.invoice_settings?.default_payment_method?.id ?? null);
    }
    if (!pm) {
      const cards = await stripe.paymentMethods.list({
        customer: org.stripeCustomerId,
        type: "card",
        limit: 1,
      });
      pm = cards.data[0]?.id ?? null;
    }
  }
  // Unblock hosting/add-on auto-charge without waiting for the webhook.
  await promoteDefaultPaymentMethod(primarySub);

  // Fan out: every entry beyond those already settled.
  const settledNow = new Set<string>(); // productIds paid within this run
  const recovery: Extract<FinalizeState, { state: "pending" }>["items"] = [];
  for (const entry of entries) {
    const existing = subFor(entry.productId);
    if (existing && SETTLED.includes(existing.status)) continue;
    const productName =
      productRows.find((p) => p.id === entry.productId)?.name ?? "your service";

    if (existing) {
      // Incomplete sub occupies the slot — resume its open first invoice.
      if (!existing.stripeSubscriptionId) continue; // one-time-only: webhook settles it
      const inv = (
        await stripe.invoices.list({ subscription: existing.stripeSubscriptionId, limit: 1 })
      ).data[0];
      if (!inv?.id || inv.status === "paid") continue;
      const outcome = await payInvoiceOffSession(stripe, inv.id, pm);
      if (outcome === "paid") {
        settledNow.add(entry.productId);
        await db
          .update(subscriptions)
          .set({ status: "active" })
          .where(eq(subscriptions.id, existing.id));
        await emitSubscriptionLifecycle(existing.id, "subscription.activated");
      } else {
        const detailed = await stripe.invoices.retrieve(inv.id, {
          expand: ["confirmation_secret"],
        });
        const secret = detailed.confirmation_secret?.client_secret;
        if (secret) {
          recovery.push({ productId: entry.productId, productName, status: outcome, clientSecret: secret });
        }
      }
      continue;
    }

    try {
      const res = await createCheckout({
        tenantId: invite.tenantId,
        productId: entry.productId,
        componentIds: entryComponentIds(entry),
        contact: { email: clientUser.email, name: clientUser.name },
        skipAutoPromos: true,
        userId: invite.userId,
        ...(pm ? { offSession: { paymentMethodId: pm } } : {}),
      });
      if (res.paymentStatus === "paid") {
        settledNow.add(entry.productId);
        await db
          .update(subscriptions)
          .set({ status: "active" })
          .where(and(eq(subscriptions.id, res.subscriptionId), eq(subscriptions.status, "incomplete")));
        await emitSubscriptionLifecycle(res.subscriptionId, "subscription.activated");
      } else if (res.clientSecret) {
        // No saved card (mode payment/setup) or the off-session charge needs help.
        recovery.push({
          productId: entry.productId,
          productName,
          status: res.paymentStatus ?? "requires_payment",
          clientSecret: res.clientSecret,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A concurrent finalize won the slot — re-check on the next pass.
      if (!/already have an active/i.test(msg)) throw e;
    }
  }

  // Attach per-product domains once their subscription is live (incl. primary).
  const liveSubs = await db.query.subscriptions.findMany({
    where: and(
      eq(subscriptions.tenantId, invite.tenantId),
      inArray(subscriptions.productId, entryProductIds),
      inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES),
    ),
  });
  for (const entry of entries) {
    if (!entry.domainUrl) continue;
    const sub = liveSubs.find((s) => s.productId === entry.productId);
    if (!sub || !(SETTLED.includes(sub.status) || settledNow.has(entry.productId))) continue;
    const prov = await db.query.subscriptionProvisioning.findFirst({
      where: eq(subscriptionProvisioning.subscriptionId, sub.id),
    });
    if (prov?.domainUrl === entry.domainUrl) continue; // already attached
    await setDomain(sub.id, entry.domainUrl, invite.createdByUserId ?? invite.userId).catch(
      (e) => console.error("[onboarding] domain attach failed:", e),
    );
  }

  const allSettled = entries.every((e) => {
    const sub = liveSubs.find((s) => s.productId === e.productId);
    return sub && (SETTLED.includes(sub.status) || settledNow.has(e.productId));
  });
  if (!allSettled) {
    return recovery.length ? { state: "pending", items: recovery } : { state: "awaiting_payment" };
  }

  const accepted = await db
    .update(onboardingInvites)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(and(eq(onboardingInvites.id, invite.id), eq(onboardingInvites.status, invite.status)))
    .returning();
  if (accepted.length) {
    await writeAudit({
      tenantId: invite.tenantId,
      actorUserId: invite.userId,
      kind: "client_setup_completed",
      payload: {
        subscriptionIds: liveSubs
          .filter((s) => entryProductIds.includes(s.productId))
          .map((s) => s.id),
      },
    });
    // The negotiated prices were for this onboarding only. Every subscription
    // has snapshotted them by now, so the tenant goes back to list price for
    // anything it buys later — ops sets Custom pricing deliberately if not.
    const released = await db
      .delete(tenantPriceOverrides)
      .where(eq(tenantPriceOverrides.sourceInviteId, invite.id))
      .returning({ componentId: tenantPriceOverrides.componentId, amountCents: tenantPriceOverrides.amountCents });
    if (released.length) {
      await writeAudit({
        tenantId: invite.tenantId,
        actorUserId: invite.userId,
        kind: "setup_pricing_released",
        payload: { inviteId: invite.id, components: released },
      });
    }
  }
  return { state: "complete" };
}

async function payInvoiceOffSession(
  stripe: ReturnType<typeof getStripe>,
  invoiceId: string,
  pm: string | null,
): Promise<"paid" | "requires_action" | "requires_payment"> {
  if (!pm) return "requires_payment";
  try {
    await stripe.invoices.pay(invoiceId, { payment_method: pm, off_session: true });
    return "paid";
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    const msg = err instanceof Error ? err.message : String(err);
    if (code === "invoice_already_paid" || /already paid/i.test(msg)) return "paid";
    if (code === "authentication_required") return "requires_action";
    return "requires_payment";
  }
}

/** Webhook backstop: finish any pending setup for this Stripe customer —
 *  covers the browser dying the instant after the primary payment confirms. */
export async function finalizePendingInvitesForCustomer(stripeCustomerId: string): Promise<void> {
  const org = await db.query.organization.findFirst({
    where: eq(organization.stripeCustomerId, stripeCustomerId),
  });
  if (!org) return;
  const pending = await db.query.onboardingInvites.findMany({
    where: and(eq(onboardingInvites.tenantId, org.id), eq(onboardingInvites.status, "pending")),
  });
  for (const invite of pending) {
    await runFinalize(invite.id).catch((e) =>
      console.warn("[onboarding] webhook finalize skipped:", e instanceof Error ? e.message : e),
    );
  }
}

export async function revokeSetup(inviteId: string, actorUserId?: string): Promise<void> {
  const [row] = await db
    .update(onboardingInvites)
    .set({ status: "revoked" })
    .where(and(eq(onboardingInvites.id, inviteId), inArray(onboardingInvites.status, ["pending", "expired"])))
    .returning({ tenantId: onboardingInvites.tenantId });
  if (!row) throw new Error("Only a pending or expired setup link can be revoked");
  // Prices held for this link die with it (Phase 2: invite-held pricing).
  await db.delete(tenantPriceOverrides).where(eq(tenantPriceOverrides.sourceInviteId, inviteId));
  await writeAudit({
    tenantId: row.tenantId,
    actorUserId: actorUserId ?? null,
    kind: "client_setup_revoked",
    payload: { inviteId },
  });
}

/**
 * Rotate the token on an existing invite and return a fresh /welcome link —
 * for when the original link was lost, expired, or revoked. Reuses the invite's
 * locked products/pricing/client, so ops never has to re-enter anything.
 * Refuses once the client has already completed setup.
 */
export async function regenerateSetupLink(
  inviteId: string,
  actorUserId: string,
  opts: { emailClient?: boolean } = {},
): Promise<{ link: string; sentTo: string | null; emailError: string | null }> {
  const invite = await db.query.onboardingInvites.findFirst({
    where: eq(onboardingInvites.id, inviteId),
  });
  if (!invite) throw new Error("Setup link not found");
  if (invite.status === "accepted") throw new Error("This client has already completed setup");

  const raw = randomBytes(24).toString("hex");
  await db
    .update(onboardingInvites)
    .set({
      tokenHash: sha256(raw),
      tokenEnc: sealToken(raw),
      status: "pending",
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    })
    .where(eq(onboardingInvites.id, inviteId));

  await writeAudit({
    tenantId: invite.tenantId,
    actorUserId,
    kind: "client_setup_created",
    payload: { regenerated: true, inviteId, emailed: Boolean(opts.emailClient) },
  });

  const link = `${env.APP_BASE_URL}${AUTH.welcome(raw)}`;
  let sentTo: string | null = null;
  let emailError: string | null = null;
  if (opts.emailClient) {
    try {
      sentTo = await sendSetupLinkEmail(inviteId, link);
    } catch (e) {
      emailError = e instanceof Error ? e.message : "Email failed";
    }
  }
  return { link, sentTo, emailError };
}
