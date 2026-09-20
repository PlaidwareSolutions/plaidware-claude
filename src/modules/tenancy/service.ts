import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { sendInvitationEmail } from "../../lib/invite-email";
import { invitation, member, organization, user } from "../auth/schema";
import { invoices, subscriptions } from "../billing/schema";
import { LIVE_SUBSCRIPTION_STATUSES } from "../billing/mappers";
import { onboardingInvites } from "../onboarding/schema";
import { writeAudit } from "../audit/service";
import { emitMembershipChanged, emitOrganizationUpdated } from "../webhooks_out/service";
import type { AssignableTenantRole } from "@/lib/roles";

export type TenantStatus = "active" | "suspended" | "inactive";

/** Used by ops creation now and checkout auto-creation in M3. */
export async function createTenantWithOwner(opts: {
  name: string;
  slug: string;
  ownerUserId: string;
}) {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organization)
      .values({
        id: crypto.randomUUID(),
        name: opts.name,
        slug: opts.slug,
        status: "active",
        createdAt: new Date(),
      })
      .returning();
    await tx.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: org.id,
      userId: opts.ownerUserId,
      role: "owner",
      createdAt: new Date(),
    });
    return org;
  });
}

/** Derive a unique slug from a seed (email local-part or name) — PRD §4.2. */
export async function uniqueSlug(seed: string): Promise<string> {
  const base =
    seed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "tenant";
  let candidate = base;
  for (let i = 2; ; i++) {
    const hit = await db.query.organization.findFirst({
      where: eq(organization.slug, candidate),
      columns: { id: true },
    });
    if (!hit) return candidate;
    candidate = `${base}-${i}`;
  }
}

/**
 * Workspace lifecycle. Enforced by policy.requireMembership: suspended keeps
 * read + billing for the client's own members, inactive is read-only. Ops
 * admins are never gated.
 */
export async function setTenantStatus(
  tenantId: string,
  status: TenantStatus,
  opts: { actorUserId?: string | null; note?: string | null } = {},
) {
  const before = await db.query.organization.findFirst({
    where: eq(organization.id, tenantId),
    columns: { status: true },
  });
  if (!before) throw new Error("Tenant not found");
  const [row] = await db
    .update(organization)
    .set({ status })
    .where(eq(organization.id, tenantId))
    .returning();
  if (before.status !== status) {
    await writeAudit({
      tenantId,
      actorUserId: opts.actorUserId ?? null,
      kind: "workspace_status_changed",
      payload: { before: before.status ?? "active", after: status, note: opts.note ?? null },
    });
    await emitOrganizationUpdated(tenantId);
  }
  return row;
}

// ---------------------------------------------------------------------------
// Ops-side member management. Better Auth's organization routes act as the
// calling user and throw MEMBER_NOT_FOUND for anyone who isn't a member of the
// org — which ops admins deliberately are not. These write the same rows the
// plugin does, and emit the same MHub membership events.
// ---------------------------------------------------------------------------

const INVITE_DAYS = 7;

export async function opsInviteMember(opts: {
  tenantId: string;
  email: string;
  role: AssignableTenantRole;
  inviterUserId: string;
}): Promise<{ invitationId: string }> {
  const email = opts.email.trim().toLowerCase();
  const [org, inviter, existingMember, pending] = await Promise.all([
    db.query.organization.findFirst({ where: eq(organization.id, opts.tenantId) }),
    db.query.user.findFirst({ where: eq(user.id, opts.inviterUserId) }),
    db
      .select({ id: member.id })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(and(eq(member.organizationId, opts.tenantId), eq(user.email, email)))
      .limit(1),
    db.query.invitation.findFirst({
      where: and(
        eq(invitation.organizationId, opts.tenantId),
        eq(invitation.email, email),
        eq(invitation.status, "pending"),
      ),
    }),
  ]);
  if (!org) throw new Error("Tenant not found");
  if (!inviter) throw new Error("Inviter not found");
  if (existingMember.length) throw new Error(`${email} is already a member of ${org.name}`);
  if (pending && pending.expiresAt > new Date()) {
    throw new Error(`${email} already has a pending invitation — cancel it first to resend`);
  }

  const id = crypto.randomUUID();
  await db.insert(invitation).values({
    id,
    organizationId: opts.tenantId,
    email,
    role: opts.role,
    status: "pending",
    expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    inviterId: opts.inviterUserId,
  });
  await sendInvitationEmail({
    to: email,
    invitationId: id,
    organizationName: org.name,
    inviterName: inviter.name,
    role: opts.role,
  });
  await writeAudit({
    tenantId: opts.tenantId,
    actorUserId: opts.inviterUserId,
    kind: "member_invited",
    payload: { email, role: opts.role, invitationId: id },
  });
  return { invitationId: id };
}

export async function opsCancelInvite(tenantId: string, invitationId: string, actorUserId: string) {
  const [row] = await db
    .update(invitation)
    .set({ status: "canceled" })
    .where(
      and(
        eq(invitation.id, invitationId),
        eq(invitation.organizationId, tenantId),
        eq(invitation.status, "pending"),
      ),
    )
    .returning({ email: invitation.email });
  if (!row) throw new Error("Invitation not found or already handled");
  await writeAudit({
    tenantId,
    actorUserId,
    kind: "invite_canceled",
    payload: { email: row.email, invitationId },
  });
}

export async function opsUpdateMemberRole(opts: {
  tenantId: string;
  memberId: string;
  role: AssignableTenantRole;
  actorUserId: string;
}) {
  const target = await db.query.member.findFirst({
    where: and(eq(member.id, opts.memberId), eq(member.organizationId, opts.tenantId)),
  });
  if (!target) throw new Error("Member not found");
  assertNotOwner(target.role, "given a different role");
  if (target.role === opts.role) return;
  await db.update(member).set({ role: opts.role }).where(eq(member.id, target.id));
  await emitMembershipChanged({ orgId: opts.tenantId, userId: target.userId, role: opts.role, action: "updated" });
  await writeAudit({
    tenantId: opts.tenantId,
    actorUserId: opts.actorUserId,
    kind: "member_role_changed",
    payload: { userId: target.userId, before: target.role, after: opts.role },
  });
}

export async function opsRemoveMember(opts: { tenantId: string; memberId: string; actorUserId: string }) {
  const target = await db.query.member.findFirst({
    where: and(eq(member.id, opts.memberId), eq(member.organizationId, opts.tenantId)),
  });
  if (!target) throw new Error("Member not found");
  assertNotOwner(target.role, "removed");
  await db.delete(member).where(eq(member.id, target.id));
  await emitMembershipChanged({ orgId: opts.tenantId, userId: target.userId, role: target.role, action: "removed" });
  await writeAudit({
    tenantId: opts.tenantId,
    actorUserId: opts.actorUserId,
    kind: "member_removed",
    payload: { userId: target.userId, role: target.role },
  });
}

/** Ops fixes a contact phone (e.g. the onboarding placeholder). */
export async function opsSetUserPhone(opts: { tenantId: string; userId: string; phone: string; actorUserId: string }) {
  const membership = await db.query.member.findFirst({
    where: and(eq(member.organizationId, opts.tenantId), eq(member.userId, opts.userId)),
    columns: { id: true },
  });
  if (!membership) throw new Error("That person isn't a member of this workspace");
  await db.update(user).set({ phone: opts.phone }).where(eq(user.id, opts.userId));
  await writeAudit({
    tenantId: opts.tenantId,
    actorUserId: opts.actorUserId,
    kind: "member_phone_updated",
    payload: { userId: opts.userId },
  });
}

/**
 * Exactly one owner per tenant (PRD §4.2): transfer demotes the current owner
 * to admin and promotes the target, atomically.
 */
export async function transferOwnership(tenantId: string, toUserId: string, actorUserId: string) {
  const changed = await db.transaction(async (tx) => {
    const owner = await tx.query.member.findFirst({
      where: and(eq(member.organizationId, tenantId), eq(member.role, "owner")),
    });
    if (!owner) throw new Error("Tenant has no owner");
    if (owner.userId === toUserId) return null; // already the owner
    const target = await tx.query.member.findFirst({
      where: and(eq(member.organizationId, tenantId), eq(member.userId, toUserId)),
    });
    if (!target) throw new Error("New owner must already be a member");
    await tx.update(member).set({ role: "admin" }).where(eq(member.id, owner.id));
    await tx.update(member).set({ role: "owner" }).where(eq(member.id, target.id));
    return { demoted: owner.userId, promoted: target.userId };
  });
  // Direct Drizzle writes bypass the Better Auth organizationHooks, so the
  // MHub membership events are emitted here (no-ops outside marketing scope).
  if (changed) {
    await emitMembershipChanged({ orgId: tenantId, userId: changed.demoted, role: "admin", action: "updated" });
    await emitMembershipChanged({ orgId: tenantId, userId: changed.promoted, role: "owner", action: "updated" });
    const people = await db.query.user.findMany({
      where: inArray(user.id, [changed.demoted, changed.promoted]),
      columns: { id: true, email: true },
    });
    const emailOf = (id: string) => people.find((p) => p.id === id)?.email ?? null;
    await writeAudit({
      tenantId,
      actorUserId,
      kind: "ownership_transferred",
      payload: {
        fromUserId: changed.demoted,
        toUserId: changed.promoted,
        fromEmail: emailOf(changed.demoted),
        toEmail: emailOf(changed.promoted),
      },
    });
  }
}

/** Owner memberships are protected: not removable, role not editable (PRD §4.2). */
export function assertNotOwner(role: string, action: string): void {
  if (role === "owner") {
    throw new Error(`The owner can't be ${action}. Transfer ownership first.`);
  }
}

export type DeleteTenantPreview = {
  members: number;
  subscriptions: number;
  liveSubscriptions: number;
  invoices: number;
  openInvoices: number;
  setupInvites: number;
  stripeCustomerId: string | null;
};

/** What a delete would take with it — and what blocks it (live subscriptions). */
export async function deleteTenantPreview(tenantId: string): Promise<DeleteTenantPreview> {
  const [org, members, subs, invs, invites] = await Promise.all([
    db.query.organization.findFirst({ where: eq(organization.id, tenantId), columns: { stripeCustomerId: true } }),
    db.query.member.findMany({ where: eq(member.organizationId, tenantId), columns: { id: true } }),
    db.query.subscriptions.findMany({ where: eq(subscriptions.tenantId, tenantId), columns: { status: true } }),
    db.query.invoices.findMany({ where: eq(invoices.tenantId, tenantId), columns: { status: true } }),
    db.query.onboardingInvites.findMany({ where: eq(onboardingInvites.tenantId, tenantId), columns: { id: true } }),
  ]);
  const live = LIVE_SUBSCRIPTION_STATUSES as readonly string[];
  return {
    members: members.length,
    subscriptions: subs.length,
    liveSubscriptions: subs.filter((s) => live.includes(s.status)).length,
    invoices: invs.length,
    openInvoices: invs.filter((i) => i.status === "open" || i.status === "failed").length,
    setupInvites: invites.length,
    stripeCustomerId: org?.stripeCustomerId ?? null,
  };
}

export async function deleteTenant(tenantId: string, confirmSlug: string) {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, tenantId),
  });
  if (!org) throw new Error("Tenant not found");
  if (org.slug !== confirmSlug) {
    throw new Error("Confirmation doesn't match the workspace slug");
  }
  const live = await db.query.subscriptions.findMany({
    where: and(
      eq(subscriptions.tenantId, tenantId),
      inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES),
    ),
    columns: { id: true },
  });
  if (live.length) {
    throw new Error(
      `Cancel ${live.length} live subscription${live.length === 1 ? "" : "s"} first — deleting would leave Stripe billing them.`,
    );
  }
  await db.delete(organization).where(eq(organization.id, tenantId));
  return org;
}
