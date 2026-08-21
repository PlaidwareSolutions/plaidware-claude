import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { env } from "../../env";
import { auth } from "../../lib/auth";
import { getStripe } from "../../lib/stripe";
import { emailButton, emailShell, sendEmail } from "../../lib/email";
import { formatCents } from "../../lib/money";
import { account, organization, user } from "../auth/schema";
import { productComponents, products } from "../catalog/schema";
import { subscriptions, tenantPriceOverrides } from "../billing/schema";
import { isRecurringKind, LIVE_SUBSCRIPTION_STATUSES } from "../billing/mappers";
import { createCheckout, promoteDefaultPaymentMethod } from "../billing/service";
import { createTenantWithOwner, uniqueSlug } from "../tenancy/service";
import { getUserTenants } from "../tenancy/queries";
import { setDomain } from "../provisioning/service";
import { subscriptionProvisioning } from "../provisioning/schema";
import { writeAudit } from "../audit/service";
import { onboardingInvites } from "./schema";
import {
  buildProductProposal,
  combineTotals,
  pickPrimaryIndex,
  type InviteProductEntry,
  type ProposalProduct,
} from "./proposal";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const INVITE_DAYS = 14;

// ---------------------------------------------------------------------------
// Ops: prepare everything, get one link
// ---------------------------------------------------------------------------

export async function createClientSetup(opts: {
  clientName: string;
  clientEmail: string;
  tenantName: string;
  /** Locked per-product selections; priceCents null = list price. */
  products: {
    productId: string;
    items: { componentId: string; priceCents: number | null }[];
    domainUrl?: string | null;
  }[];
  sendEmailToClient: boolean;
  actorUserId: string;
}): Promise<{ link: string; inviteId: string; tenantId: string }> {
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

  // 1. Find or create the client's account (password set on the welcome page).
  let clientUser = await db.query.user.findFirst({ where: eq(user.email, email) });
  if (!clientUser) {
    const [first, ...rest] = opts.clientName.trim().split(/\s+/);
    await auth.api.signUpEmail({
      body: {
        email,
        password: `Setup-${randomBytes(16).toString("hex")}`,
        name: opts.clientName.trim(),
        firstName: first || "Client",
        lastName: rest.join(" ") || "-",
        phone: "+10000000000", // placeholder; the client can update in Settings
      },
    });
    clientUser = (await db.query.user.findFirst({ where: eq(user.email, email) }))!;
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

  // 3. Custom prices become tenant overrides (only where they differ from list).
  for (const p of opts.products) {
    for (const item of p.items) {
      const comp = comps.find((c) => c.id === item.componentId);
      if (!comp || item.priceCents == null || item.priceCents === comp.amountCents) continue;
      await db
        .insert(tenantPriceOverrides)
        .values({
          tenantId,
          componentId: item.componentId,
          amountCents: item.priceCents,
          createdByUserId: opts.actorUserId,
        })
        .onConflictDoUpdate({
          target: [tenantPriceOverrides.tenantId, tenantPriceOverrides.componentId],
          set: {
            amountCents: item.priceCents,
            stripePriceId: null, // re-mint at next use
            createdByUserId: opts.actorUserId,
          },
        });
    }
  }

  // 4. Mint the single-use link.
  const raw = randomBytes(24).toString("hex");
  const entries: InviteProductEntry[] = opts.products.map((p) => ({
    productId: p.productId,
    componentIds: p.items.map((i) => i.componentId),
    domainUrl: p.domainUrl?.trim() || null,
  }));
  const [invite] = await db
    .insert(onboardingInvites)
    .values({
      tokenHash: sha256(raw),
      tenantId,
      userId: clientUser.id,
      products: entries,
      createdByUserId: opts.actorUserId,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    })
    .returning();

  await writeAudit({
    tenantId,
    actorUserId: opts.actorUserId,
    kind: "client_setup_created",
    payload: {
      products: opts.products.map((p) => ({ productId: p.productId, items: p.items.length })),
      email,
    },
  });

  const link = `${env.APP_BASE_URL}/welcome/${raw}`;

  if (opts.sendEmailToClient) {
    const proposal = await assembleProposal(invite.id);
    const names = proposal?.products.map((p) => p.productName).join(" + ");
    void sendEmail({
      to: email,
      subject: "Your Plaidware setup is ready",
      html: emailShell(
        `Welcome, ${opts.clientName.trim()}`,
        `<p>Your ${names ? `${names} ` : ""}services are configured and ready to activate. One step: open the link below, choose a password, and complete payment.</p>` +
          (proposal
            ? `<p><strong>Due today: ${formatCents(proposal.dueTodayCents)}</strong>${proposal.monthlyCents ? ` · then ${formatCents(proposal.monthlyCents)}/mo` : ""}${proposal.yearlyCents ? ` + ${formatCents(proposal.yearlyCents)}/yr` : ""}</p>` +
              (proposal.products.length > 1
                ? `<p style="color:#8b93b2;font-size:13px">Your card will be charged separately for each service — ${proposal.products.length} charges totaling ${formatCents(proposal.dueTodayCents)} today.</p>`
                : "")
            : "") +
          emailButton(link, "Complete your setup") +
          `<p style="color:#8b93b2;font-size:13px">This link is personal to you and expires in ${INVITE_DAYS} days.</p>`,
      ),
    });
  }

  return { link, inviteId: invite.id, tenantId };
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
  const allComponentIds = invite.products.flatMap((p) => p.componentIds);
  const [clientUser, productRows, comps, overrides, org] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, invite.userId) }),
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
  const proposalProducts = invite.products.map((entry) =>
    buildProductProposal(
      entry,
      productRows.find((p) => p.id === entry.productId)?.name ?? "Product",
      comps.filter((c) => entry.componentIds.includes(c.id)),
      overrideAmounts,
    ),
  );
  const recurringIds = new Set(comps.filter((c) => isRecurringKind(c.kind)).map((c) => c.id));

  return {
    inviteId: invite.id,
    status: invite.status,
    clientName: clientUser.name,
    clientEmail: clientUser.email,
    tenantId: invite.tenantId,
    tenantName: org?.name ?? "your workspace",
    // Password step needed while the account is still ops-provisioned (unverified).
    needsPassword: !clientUser.emailVerified,
    products: proposalProducts,
    primaryIndex: pickPrimaryIndex(invite.products, (id) => recurringIds.has(id)),
    ...combineTotals(proposalProducts),
  };
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
  // Only while the account is still ops-provisioned; afterwards use normal sign-in.
  if (clientUser.emailVerified) {
    throw new Error("Password already set — sign in with your existing password");
  }

  const ctx = await auth.$context;
  const hash = await ctx.password.hash(newPassword);
  await db
    .update(account)
    .set({ password: hash })
    .where(and(eq(account.userId, invite.userId), eq(account.providerId, "credential")));
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, invite.userId));
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
      where: inArray(productComponents.id, entries.flatMap((e) => e.componentIds)),
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
        componentIds: entry.componentIds,
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

export async function revokeSetup(inviteId: string): Promise<void> {
  await db
    .update(onboardingInvites)
    .set({ status: "revoked" })
    .where(eq(onboardingInvites.id, inviteId));
}
