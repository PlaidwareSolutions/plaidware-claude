import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { env } from "../../env";
import { INVITATION_DAYS, sendInvitationEmail } from "../../lib/invite-email";
import { invitation, member, organization, user } from "../auth/schema";
import { roleRequests } from "./schema";
import { listMembers } from "./queries";
import { sendRoleRequestDecidedEmail, sendRoleRequestedEmail } from "../../lib/role-request-email";
import {
  canCancelRoleRequest,
  canDecideRoleRequest,
  canRequestRole,
  canRequestRoleChange,
  isRoleRequestStale,
  roleLabel,
  roleRequestDeciders,
} from "./role-request-rules";
import { invoices, subscriptions } from "../billing/schema";
import { LIVE_SUBSCRIPTION_STATUSES } from "../billing/mappers";
import { onboardingInvites } from "../onboarding/schema";
import { writeAudit } from "../audit/service";
import { emitMembershipChanged, emitOrganizationUpdated } from "../webhooks_out/service";
import { isAssignableTenantRole, type AssignableTenantRole } from "@/lib/roles";
import { canAddMembership } from "./membership-rules";

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
    throw new Error(`${email} already has a pending invitation — use Resend on it`);
  }

  const id = crypto.randomUUID();
  await db.insert(invitation).values({
    id,
    organizationId: opts.tenantId,
    email,
    role: opts.role,
    status: "pending",
    expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
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

/**
 * Ops puts an existing account straight onto a workspace — no invitation, no
 * email. The one way a developer gets client context (their brief under
 * Work → Clients); for a customer it is an invitation minus the round trip.
 * Ops path: writes directly (not subject to the Better Auth org hooks, so it
 * works on a suspended workspace too), emits to MHub like an accepted
 * invitation, and audits on the workspace (the row also lands on the
 * account's Activity tab through payload.userId).
 */
export async function opsAddMember(opts: {
  tenantId: string;
  userId: string;
  role: AssignableTenantRole;
  actorUserId: string;
}): Promise<{ memberId: string; tenantName: string }> {
  const [org, target, existing] = await Promise.all([
    db.query.organization.findFirst({ where: eq(organization.id, opts.tenantId), columns: { id: true, name: true } }),
    db.query.user.findFirst({
      where: eq(user.id, opts.userId),
      columns: { id: true, email: true, platformRole: true, disabledAt: true },
    }),
    db.query.member.findFirst({
      where: and(eq(member.organizationId, opts.tenantId), eq(member.userId, opts.userId)),
      columns: { role: true },
    }),
  ]);
  if (!org) throw new Error("Workspace not found");
  if (!target) throw new Error("User not found");
  const verdict = canAddMembership({ existingRole: existing?.role ?? null, targetDisabled: !!target.disabledAt, role: opts.role });
  if (!verdict.ok) throw new Error(verdict.reason);

  const memberId = crypto.randomUUID();
  await db.insert(member).values({
    id: memberId,
    organizationId: org.id,
    userId: target.id,
    role: opts.role,
    createdAt: new Date(),
  });
  await emitMembershipChanged({ orgId: org.id, userId: target.id, role: opts.role, action: "added" });
  await writeAudit({
    tenantId: org.id,
    actorUserId: opts.actorUserId,
    kind: "member_added",
    payload: { userId: target.id, email: target.email, role: opts.role, platformRole: target.platformRole ?? "customer" },
  });
  return { memberId, tenantName: org.name };
}

/**
 * Re-send a pending invitation as-is: the id, and therefore the link already
 * in the inbox, stays valid; the expiry moves forward so the copy stays true.
 * One writer for tenant and ops callers (policy has already gated the action).
 */
export async function resendInvitation(opts: { tenantId: string; invitationId: string; actorUserId: string }): Promise<{ email: string }> {
  const inv = await db.query.invitation.findFirst({
    where: and(eq(invitation.id, opts.invitationId), eq(invitation.organizationId, opts.tenantId), eq(invitation.status, "pending")),
  });
  if (!inv) throw new Error("Invitation not found or already handled");
  if (inv.expiresAt <= new Date()) throw new Error("This invitation has expired — cancel it and invite again");
  const [org, inviter, actor] = await Promise.all([
    db.query.organization.findFirst({ where: eq(organization.id, opts.tenantId), columns: { name: true } }),
    db.query.user.findFirst({ where: eq(user.id, inv.inviterId), columns: { name: true } }),
    db.query.user.findFirst({ where: eq(user.id, opts.actorUserId), columns: { name: true } }),
  ]);
  if (!org) throw new Error("Tenant not found");
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 86_400_000);
  await db.update(invitation).set({ expiresAt }).where(eq(invitation.id, inv.id));
  const r = await sendInvitationEmail({
    to: inv.email,
    invitationId: inv.id,
    organizationName: org.name,
    inviterName: inviter?.name ?? actor?.name ?? "A workspace admin",
    role: inv.role ?? "member",
  });
  if (!r.sent && env.RESEND_API_KEY) throw new Error(`Email to ${inv.email} failed: ${r.error}`);
  await writeAudit({
    tenantId: opts.tenantId,
    actorUserId: opts.actorUserId,
    kind: "invite_resent",
    payload: { email: inv.email, role: inv.role, invitationId: inv.id, expiresAt: expiresAt.toISOString() },
  });
  return { email: inv.email };
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

type Executor = typeof db | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/**
 * The one writer for a member's tenant role (tenant- and ops-side alike).
 * Throws for owners and unknown members; null when nothing changed.
 */
export async function setMemberRole(
  exec: Executor,
  opts: { tenantId: string; memberId: string; role: AssignableTenantRole },
): Promise<{ userId: string; before: string } | null> {
  const target = await exec.query.member.findFirst({
    where: and(eq(member.id, opts.memberId), eq(member.organizationId, opts.tenantId)),
  });
  if (!target) throw new Error("Member not found");
  assertNotOwner(target.role, "given a different role");
  if (target.role === opts.role) return null;
  await exec.update(member).set({ role: opts.role }).where(eq(member.id, target.id));
  return { userId: target.userId, before: target.role };
}

/**
 * After a role write commits: MHub emit, audit, and — unless the write was
 * itself an approval — any open request from that member is now moot.
 */
export async function afterMemberRoleChanged(opts: {
  tenantId: string;
  memberId: string;
  userId: string;
  before: string;
  after: string;
  actorUserId: string;
  requestId?: string;
}) {
  await emitMembershipChanged({ orgId: opts.tenantId, userId: opts.userId, role: opts.after, action: "updated" });
  await writeAudit({
    tenantId: opts.tenantId,
    actorUserId: opts.actorUserId,
    kind: "member_role_changed",
    payload: { userId: opts.userId, before: opts.before, after: opts.after, ...(opts.requestId ? { requestId: opts.requestId } : {}) },
  });
  if (!opts.requestId) {
    await cancelOpenRoleRequestsForMember({ tenantId: opts.tenantId, memberId: opts.memberId, reason: "role_changed", actorUserId: opts.actorUserId });
  }
}

export async function updateMemberRole(opts: {
  tenantId: string;
  memberId: string;
  role: AssignableTenantRole;
  actorUserId: string;
}) {
  const changed = await setMemberRole(db, opts);
  if (changed) {
    await afterMemberRoleChanged({ ...opts, userId: changed.userId, before: changed.before, after: opts.role });
  }
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
    return { demoted: owner.userId, promoted: target.userId, promotedMemberId: target.id };
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
    await cancelOpenRoleRequestsForMember({ tenantId, memberId: changed.promotedMemberId, reason: "role_changed", actorUserId });
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

// ---------------------------------------------------------------------------
// Role requests (self-service role changes, decided by owners/admins or ops)
// ---------------------------------------------------------------------------

const isUniqueViolation = (e: unknown) => {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
};

export async function createRoleRequest(opts: {
  tenantId: string;
  userId: string;
  requestedRole: AssignableTenantRole;
  note: string | null;
}): Promise<string> {
  const [row] = await db
    .select({ memberId: member.id, role: member.role, status: organization.status, orgName: organization.name })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(and(eq(member.organizationId, opts.tenantId), eq(member.userId, opts.userId)))
    .limit(1);
  if (!row) throw new Error("You're not a member of this workspace");
  for (const v of [
    canRequestRoleChange({ role: row.role, tenantStatus: row.status }),
    canRequestRole({ currentRole: row.role, requestedRole: opts.requestedRole }),
  ]) {
    if (!v.ok) throw new Error(v.reason);
  }

  let created: { id: string } | undefined;
  try {
    [created] = await db
      .insert(roleRequests)
      .values({
        tenantId: opts.tenantId,
        memberId: row.memberId,
        userId: opts.userId,
        requestedRole: opts.requestedRole,
        currentRole: row.role,
        note: opts.note,
      })
      .returning({ id: roleRequests.id });
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error("You already have a pending request.");
    throw e;
  }
  if (!created) throw new Error("Could not create the request");
  await writeAudit({
    tenantId: opts.tenantId,
    actorUserId: opts.userId,
    kind: "role_requested",
    payload: { userId: opts.userId, memberId: row.memberId, before: row.role, requested: opts.requestedRole, note: opts.note, requestId: created.id },
  });

  // Tell the people who can decide. A mail failure never fails the request.
  const members = await listMembers(opts.tenantId);
  const requester = members.find((m) => m.userId === opts.userId);
  const deciders = roleRequestDeciders(members).filter((m) => m.userId !== opts.userId);
  await Promise.allSettled(
    deciders.map((d) =>
      sendRoleRequestedEmail({
        to: d.email,
        requesterName: requester?.name ?? "A member",
        organizationName: row.orgName,
        currentRole: row.role,
        requestedRole: opts.requestedRole,
        note: opts.note,
      }),
    ),
  );
  return created.id;
}

type PendingRequest = typeof roleRequests.$inferSelect;

/** Lock the pending row and check the decider may act on it. */
async function loadPendingForDecision(
  tx: Executor,
  opts: { tenantId: string; requestId: string; actorUserId: string; actorRole: string },
): Promise<{ req: PendingRequest; live: { role: string; status: string | null } }> {
  const [req] = await tx
    .select()
    .from(roleRequests)
    .where(and(eq(roleRequests.id, opts.requestId), eq(roleRequests.tenantId, opts.tenantId), eq(roleRequests.status, "pending")))
    .for("update");
  if (!req) throw new Error("This request was already handled.");
  const [live] = await tx
    .select({ role: member.role, status: organization.status })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.id, req.memberId))
    .limit(1);
  if (!live) throw new Error("That member has left the workspace.");
  const verdict = canDecideRoleRequest({
    deciderRole: opts.actorRole,
    deciderUserId: opts.actorUserId,
    requesterUserId: req.userId,
    tenantStatus: live.status,
  });
  if (!verdict.ok) throw new Error(verdict.reason);
  return { req, live };
}

async function notifyRequester(req: PendingRequest, decision: "approved" | "denied", decisionNote: string | null, actorUserId: string) {
  try {
    const [requester, decider, org] = await Promise.all([
      db.query.user.findFirst({ where: eq(user.id, req.userId), columns: { email: true } }),
      db.query.user.findFirst({ where: eq(user.id, actorUserId), columns: { name: true } }),
      db.query.organization.findFirst({ where: eq(organization.id, req.tenantId), columns: { name: true } }),
    ]);
    if (!requester || !org) return;
    await sendRoleRequestDecidedEmail({
      to: requester.email,
      organizationName: org.name,
      requestedRole: req.requestedRole,
      decision,
      decisionNote,
      deciderName: decider?.name ?? null,
    });
  } catch (e) {
    console.error("[role-request] decision email failed", e);
  }
}

export async function approveRoleRequest(opts: { tenantId: string; requestId: string; actorUserId: string; actorRole: string }) {
  const result = await db.transaction(async (tx) => {
    const { req, live } = await loadPendingForDecision(tx, opts);
    if (isRoleRequestStale({ currentRole: req.currentRole, liveRole: live.role })) {
      await tx
        .update(roleRequests)
        .set({ status: "canceled", decidedAt: new Date(), decisionNote: `role changed to ${live.role} before this was decided` })
        .where(eq(roleRequests.id, req.id));
      return { stale: true as const, req, live };
    }
    if (!isAssignableTenantRole(req.requestedRole)) throw new Error("That role can't be assigned.");
    const changed = await setMemberRole(tx, { tenantId: opts.tenantId, memberId: req.memberId, role: req.requestedRole });
    await tx
      .update(roleRequests)
      .set({ status: "approved", decidedByUserId: opts.actorUserId, decidedAt: new Date() })
      .where(eq(roleRequests.id, req.id));
    return { stale: false as const, req, live, changed };
  });

  if (result.stale) {
    await writeAudit({
      tenantId: opts.tenantId,
      actorUserId: opts.actorUserId,
      kind: "role_request_canceled",
      payload: { userId: result.req.userId, requestId: opts.requestId, requested: result.req.requestedRole, reason: "role_changed" },
    });
    throw new Error(`Their role changed to ${roleLabel(result.live.role)} since they asked, so the request was withdrawn.`);
  }
  if (result.changed) {
    await afterMemberRoleChanged({
      tenantId: opts.tenantId,
      memberId: result.req.memberId,
      userId: result.changed.userId,
      before: result.changed.before,
      after: result.req.requestedRole,
      actorUserId: opts.actorUserId,
      requestId: opts.requestId,
    });
  }
  await writeAudit({
    tenantId: opts.tenantId,
    actorUserId: opts.actorUserId,
    kind: "role_request_approved",
    payload: { userId: result.req.userId, requestId: opts.requestId, before: result.req.currentRole, after: result.req.requestedRole },
  });
  await notifyRequester(result.req, "approved", null, opts.actorUserId);
}

export async function denyRoleRequest(opts: {
  tenantId: string;
  requestId: string;
  actorUserId: string;
  actorRole: string;
  note: string | null;
}) {
  const req = await db.transaction(async (tx) => {
    const { req } = await loadPendingForDecision(tx, opts);
    await tx
      .update(roleRequests)
      .set({ status: "denied", decidedByUserId: opts.actorUserId, decidedAt: new Date(), decisionNote: opts.note })
      .where(eq(roleRequests.id, req.id));
    return req;
  });
  await writeAudit({
    tenantId: opts.tenantId,
    actorUserId: opts.actorUserId,
    kind: "role_request_denied",
    payload: { userId: req.userId, requestId: opts.requestId, requested: req.requestedRole, note: opts.note },
  });
  await notifyRequester(req, "denied", opts.note, opts.actorUserId);
}

/** The requester withdraws, or a decider/ops dismisses (no email either way). */
export async function cancelRoleRequest(opts: { tenantId: string; requestId: string; actorUserId: string; actorRole: string }) {
  const [req] = await db
    .select()
    .from(roleRequests)
    .where(and(eq(roleRequests.id, opts.requestId), eq(roleRequests.tenantId, opts.tenantId), eq(roleRequests.status, "pending")))
    .limit(1);
  if (!req) throw new Error("This request was already handled.");
  const verdict = canCancelRoleRequest({ actorUserId: opts.actorUserId, actorRole: opts.actorRole, requesterUserId: req.userId });
  if (!verdict.ok) throw new Error(verdict.reason);
  const [claimed] = await db
    .update(roleRequests)
    .set({ status: "canceled", decidedByUserId: opts.actorUserId, decidedAt: new Date() })
    .where(and(eq(roleRequests.id, req.id), eq(roleRequests.status, "pending")))
    .returning({ id: roleRequests.id });
  if (!claimed) throw new Error("This request was already handled.");
  const reason = opts.actorUserId === req.userId ? "requester" : opts.actorRole === "ops" ? "ops" : "decider";
  await writeAudit({
    tenantId: opts.tenantId,
    actorUserId: opts.actorUserId,
    kind: "role_request_canceled",
    payload: { userId: req.userId, requestId: req.id, requested: req.requestedRole, reason },
  });
}

/** A member's role changed by other means: their open request is moot. */
export async function cancelOpenRoleRequestsForMember(opts: {
  tenantId: string;
  memberId: string;
  reason: "role_changed";
  actorUserId: string;
}) {
  const rows = await db
    .update(roleRequests)
    .set({ status: "canceled", decidedAt: new Date(), decisionNote: "role changed directly" })
    .where(and(eq(roleRequests.tenantId, opts.tenantId), eq(roleRequests.memberId, opts.memberId), eq(roleRequests.status, "pending")))
    .returning({ id: roleRequests.id, userId: roleRequests.userId, requestedRole: roleRequests.requestedRole });
  for (const r of rows) {
    await writeAudit({
      tenantId: opts.tenantId,
      actorUserId: opts.actorUserId,
      kind: "role_request_canceled",
      payload: { userId: r.userId, requestId: r.id, requested: r.requestedRole, reason: opts.reason },
    });
  }
}
