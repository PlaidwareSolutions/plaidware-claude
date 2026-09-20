"use server";

import { revalidatePath } from "next/cache";
import { TENANT } from "@/lib/routes";
import { revalidateClientViews } from "@/lib/ops-revalidate";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "../../lib/auth";
import { normalizePhone } from "../../lib/phone";
import { requireMembership, requireOps } from "../../policy";
import {
  assertNotOwner,
  deleteTenant,
  deleteTenantPreview,
  opsCancelInvite,
  opsInviteMember,
  opsRemoveMember,
  opsSetUserPhone,
  resendInvitation,
  approveRoleRequest,
  cancelRoleRequest,
  createRoleRequest,
  denyRoleRequest,
  setTenantStatus,
  transferOwnership,
  updateMemberRole,
  type DeleteTenantPreview,
} from "./service";
import { cancelRoleRequestSchema, decideRoleRequestSchema, requestRoleChangeSchema } from "./contracts";
import { listMembers } from "./queries";
import { ASSIGNABLE_TENANT_ROLES } from "@/lib/roles";

/** Tenant-side pages and the ops client page both render membership. */
function revalidateTeam(tenantId: string) {
  revalidatePath(TENANT.team);
  revalidateClientViews(tenantId);
}

type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
}

const inviteSchema = z.object({
  tenantId: z.string().min(1),
  email: z.string().email(),
  role: z.enum(ASSIGNABLE_TENANT_ROLES), // owner is never invitable (PRD §4.2)
});

export async function inviteMemberAction(input: z.infer<typeof inviteSchema>): Promise<ActionResult> {
  try {
    const parsed = inviteSchema.parse(input);
    const { session, role } = await requireMembership(parsed.tenantId, "team");
    if (role === "ops") {
      // Better Auth's org routes act as the caller, who isn't a member here.
      await opsInviteMember({ ...parsed, inviterUserId: session.user.id });
    } else {
      await auth.api.createInvitation({
        headers: await headers(),
        body: {
          organizationId: parsed.tenantId,
          email: parsed.email,
          role: parsed.role,
        },
      });
    }
    revalidateTeam(parsed.tenantId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function resendInviteAction(tenantId: string, invitationId: string): Promise<ActionResult> {
  try {
    const { session } = await requireMembership(tenantId, "team");
    await resendInvitation({ tenantId, invitationId, actorUserId: session.user.id });
    revalidateTeam(tenantId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelInviteAction(tenantId: string, invitationId: string): Promise<ActionResult> {
  try {
    const { session, role } = await requireMembership(tenantId, "team");
    if (role === "ops") {
      await opsCancelInvite(tenantId, invitationId, session.user.id);
    } else {
      await auth.api.cancelInvitation({
        headers: await headers(),
        body: { invitationId },
      });
    }
    revalidateTeam(tenantId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const roleSchema = z.object({
  tenantId: z.string().min(1),
  memberId: z.string().min(1),
  role: z.enum(ASSIGNABLE_TENANT_ROLES),
});

export async function updateMemberRoleAction(input: z.infer<typeof roleSchema>): Promise<ActionResult> {
  try {
    const parsed = roleSchema.parse(input);
    // One writer for both sides: policy (team capability + status) and the
    // owner guard decide; the service emits to MHub and audits.
    const { session } = await requireMembership(parsed.tenantId, "team");
    await updateMemberRole({ ...parsed, actorUserId: session.user.id });
    revalidateTeam(parsed.tenantId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeMemberAction(tenantId: string, memberId: string): Promise<ActionResult> {
  try {
    const { session, role } = await requireMembership(tenantId, "team");
    if (role === "ops") {
      await opsRemoveMember({ tenantId, memberId, actorUserId: session.user.id });
    } else {
      const target = (await listMembers(tenantId)).find((m) => m.memberId === memberId);
      if (!target) throw new Error("Member not found");
      assertNotOwner(target.role, "removed");
      await auth.api.removeMember({
        headers: await headers(),
        body: { organizationId: tenantId, memberIdOrEmail: memberId },
      });
    }
    revalidateTeam(tenantId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function transferOwnershipAction(tenantId: string, toUserId: string): Promise<ActionResult> {
  try {
    const { session, role } = await requireMembership(tenantId, "team");
    if (role !== "ops" && role !== "owner") {
      throw new Error("Only the owner can transfer ownership");
    }
    await transferOwnership(tenantId, toUserId, session.user.id);
    revalidateTeam(tenantId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------- Role requests ----------

function revalidateRoleRequests(tenantId: string) {
  revalidateTeam(tenantId);
  revalidatePath(TENANT.billing); // the member explainer offers "Request billing access"
}

export async function requestRoleChangeAction(input: z.infer<typeof requestRoleChangeSchema>): Promise<ActionResult> {
  try {
    const p = requestRoleChangeSchema.parse(input);
    const { session, role } = await requireMembership(p.tenantId, "read");
    if (role === "ops") throw new Error("Ops accounts don't hold workspace roles.");
    await createRoleRequest({ tenantId: p.tenantId, userId: session.user.id, requestedRole: p.role, note: p.note || null });
    revalidateRoleRequests(p.tenantId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function approveRoleRequestAction(input: z.infer<typeof decideRoleRequestSchema>): Promise<ActionResult> {
  try {
    const p = decideRoleRequestSchema.parse(input);
    const { session, role } = await requireMembership(p.tenantId, "team");
    await approveRoleRequest({ tenantId: p.tenantId, requestId: p.requestId, actorUserId: session.user.id, actorRole: role });
    revalidateRoleRequests(p.tenantId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function denyRoleRequestAction(input: z.infer<typeof decideRoleRequestSchema>): Promise<ActionResult> {
  try {
    const p = decideRoleRequestSchema.parse(input);
    const { session, role } = await requireMembership(p.tenantId, "team");
    await denyRoleRequest({ tenantId: p.tenantId, requestId: p.requestId, actorUserId: session.user.id, actorRole: role, note: p.note || null });
    revalidateRoleRequests(p.tenantId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelRoleRequestAction(input: z.infer<typeof cancelRoleRequestSchema>): Promise<ActionResult> {
  try {
    const p = cancelRoleRequestSchema.parse(input);
    const { session, role } = await requireMembership(p.tenantId, "read");
    await cancelRoleRequest({ tenantId: p.tenantId, requestId: p.requestId, actorUserId: session.user.id, actorRole: role });
    revalidateRoleRequests(p.tenantId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const phoneSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  phone: z.string().min(1).max(40),
});

/** Ops fixes a member's contact phone (the setup-link placeholder, a typo). */
export async function opsSetUserPhoneAction(input: z.infer<typeof phoneSchema>): Promise<ActionResult> {
  try {
    const session = await requireOps();
    const parsed = phoneSchema.parse(input);
    const phone = normalizePhone(parsed.phone);
    if (!phone) throw new Error("Enter a phone number with a country code, e.g. +1 555 123 4567");
    await opsSetUserPhone({ ...parsed, phone, actorUserId: session.user.id });
    revalidateTeam(parsed.tenantId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------- Ops-only ----------

export async function opsSetTenantStatusAction(
  tenantId: string,
  status: "active" | "suspended" | "inactive",
  note?: string,
): Promise<ActionResult> {
  try {
    const session = await requireOps();
    await setTenantStatus(tenantId, status, {
      actorUserId: session.user.id,
      note: note?.trim() || null,
    });
    revalidateClientViews(tenantId);
    revalidatePath("/", "layout"); // the client's own shell reads the status
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** What a delete takes with it, and whether live subscriptions block it. */
export async function opsDeleteTenantPreviewAction(
  tenantId: string,
): Promise<({ ok: true } & DeleteTenantPreview) | { ok: false; error: string }> {
  try {
    await requireOps();
    const preview = await deleteTenantPreview(tenantId);
    return { ok: true, ...preview };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Preview failed" };
  }
}

export async function opsDeleteTenantAction(tenantId: string, confirmSlug: string): Promise<ActionResult> {
  try {
    await requireOps();
    await deleteTenant(tenantId, confirmSlug);
    revalidateClientViews();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setActiveTenantAction(tenantId: string): Promise<ActionResult> {
  try {
    await requireMembership(tenantId, "read");
    await auth.api.setActiveOrganization({
      headers: await headers(),
      body: { organizationId: tenantId },
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
