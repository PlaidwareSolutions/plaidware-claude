import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { env } from "../../env";
import { auth } from "../../lib/auth";
import { emailButton, emailShell, sendEmail } from "../../lib/email";
import { formatCents } from "../../lib/money";
import { account, organization, user } from "../auth/schema";
import { productComponents, products } from "../catalog/schema";
import { tenantPriceOverrides } from "../billing/schema";
import { intervalLabel, isRecurringKind, itemMrrCents, resolveInterval } from "../billing/mappers";
import { createTenantWithOwner, uniqueSlug } from "../tenancy/service";
import { getUserTenants } from "../tenancy/queries";
import { setDomain } from "../provisioning/service";
import { writeAudit } from "../audit/service";
import { onboardingInvites } from "./schema";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const INVITE_DAYS = 14;

// ---------------------------------------------------------------------------
// Ops: prepare everything, get one link
// ---------------------------------------------------------------------------

export async function createClientSetup(opts: {
  clientName: string;
  clientEmail: string;
  tenantName: string;
  productId: string;
  /** Locked selection; priceCents null = list price. */
  items: { componentId: string; priceCents: number | null }[];
  domainUrl?: string | null;
  sendEmailToClient: boolean;
  actorUserId: string;
}): Promise<{ link: string; inviteId: string; tenantId: string }> {
  const email = opts.clientEmail.trim().toLowerCase();

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
  const comps = await db.query.productComponents.findMany({
    where: inArray(productComponents.id, opts.items.map((i) => i.componentId)),
  });
  for (const item of opts.items) {
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

  // 4. Mint the single-use link.
  const raw = randomBytes(24).toString("hex");
  const [invite] = await db
    .insert(onboardingInvites)
    .values({
      tokenHash: sha256(raw),
      tenantId,
      userId: clientUser.id,
      productId: opts.productId,
      componentIds: opts.items.map((i) => i.componentId),
      domainUrl: opts.domainUrl?.trim() || null,
      createdByUserId: opts.actorUserId,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    })
    .returning();

  await writeAudit({
    tenantId,
    actorUserId: opts.actorUserId,
    kind: "client_setup_created",
    payload: { productId: opts.productId, items: opts.items.length, email },
  });

  const link = `${env.APP_BASE_URL}/welcome/${raw}`;

  if (opts.sendEmailToClient) {
    const proposal = await assembleProposal(invite.id);
    void sendEmail({
      to: email,
      subject: "Your Plaidware setup is ready",
      html: emailShell(
        `Welcome, ${opts.clientName.trim()}`,
        `<p>Your services are configured and ready to activate. One step: open the link below, choose a password, and complete payment.</p>` +
          (proposal
            ? `<p><strong>Due today: ${formatCents(proposal.dueTodayCents)}</strong>${proposal.monthlyCents ? ` · then ${formatCents(proposal.monthlyCents)}/mo` : ""}${proposal.yearlyCents ? ` + ${formatCents(proposal.yearlyCents)}/yr` : ""}</p>`
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
  productId: string;
  productName: string;
  needsPassword: boolean;
  lines: { name: string; amountCents: number; cadence: string; oneTime: boolean }[];
  dueTodayCents: number;
  monthlyCents: number;
  yearlyCents: number;
  componentIds: string[];
};

async function assembleProposal(inviteId: string): Promise<SetupProposal | null> {
  const invite = await db.query.onboardingInvites.findFirst({
    where: eq(onboardingInvites.id, inviteId),
  });
  if (!invite) return null;
  const [clientUser, product, comps, overrides, org] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, invite.userId) }),
    db.query.products.findFirst({ where: eq(products.id, invite.productId) }),
    invite.componentIds.length
      ? db.query.productComponents.findMany({
          where: inArray(productComponents.id, invite.componentIds),
        })
      : Promise.resolve([]),
    db.query.tenantPriceOverrides.findMany({
      where: eq(tenantPriceOverrides.tenantId, invite.tenantId),
    }),
    db.query.organization.findFirst({
      where: eq(organization.id, invite.tenantId),
    }),
  ]);
  if (!clientUser || !product) return null;

  const effective = (c: (typeof comps)[number]) =>
    overrides.find((o) => o.componentId === c.id)?.amountCents ?? c.amountCents;

  let dueToday = 0;
  let monthly = 0;
  let yearly = 0;
  const lines = comps
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => {
      const amt = effective(c);
      dueToday += amt; // one-time + first period of each recurring item
      if (isRecurringKind(c.kind)) {
        const iv = resolveInterval(c);
        if (iv?.interval === "year") yearly += Math.round(amt / iv.intervalCount);
        else monthly += itemMrrCents(c, amt);
      }
      return {
        name: c.name,
        amountCents: amt,
        cadence: intervalLabel(c) || "one-time",
        oneTime: !isRecurringKind(c.kind),
      };
    });

  // Password step needed while the account is still ops-provisioned (unverified).
  const needsPassword = !clientUser.emailVerified;

  return {
    inviteId: invite.id,
    status: invite.status,
    clientName: clientUser.name,
    clientEmail: clientUser.email,
    tenantId: invite.tenantId,
    tenantName: org?.name ?? "your workspace",
    productId: invite.productId,
    productName: product.name,
    needsPassword,
    lines,
    dueTodayCents: dueToday,
    monthlyCents: monthly,
    yearlyCents: yearly,
    componentIds: invite.componentIds,
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
// Client: finalize after payment
// ---------------------------------------------------------------------------

export async function finalizeSetup(inviteId: string, subscriptionId: string): Promise<void> {
  const invite = await db.query.onboardingInvites.findFirst({
    where: and(eq(onboardingInvites.id, inviteId), isNull(onboardingInvites.acceptedAt)),
  });
  if (!invite) return; // already finalized — idempotent
  await db
    .update(onboardingInvites)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(eq(onboardingInvites.id, invite.id));
  if (invite.domainUrl) {
    await setDomain(subscriptionId, invite.domainUrl, invite.createdByUserId ?? invite.userId).catch(
      (e) => console.error("[onboarding] domain attach failed:", e),
    );
  }
  await writeAudit({
    tenantId: invite.tenantId,
    subscriptionId,
    actorUserId: invite.userId,
    kind: "client_setup_completed",
    payload: {},
  });
}

export async function revokeSetup(inviteId: string): Promise<void> {
  await db
    .update(onboardingInvites)
    .set({ status: "revoked" })
    .where(eq(onboardingInvites.id, inviteId));
}
