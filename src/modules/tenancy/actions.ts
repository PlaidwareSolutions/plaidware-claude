"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "../../lib/auth";
import { requireMembership, requireOps } from "../../policy";
import {
  assertNotOwner,
  createTenantWithOwner,
  deleteTenant,
  setTenantStatus,
  transferOwnership,
  uniqueSlug,
} from "./service";
import { findUserByEmail, listMembers } from "./queries";

type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
}

const inviteSchema = z.object({
  tenantId: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["admin", "billing", "member"]), // owner is never invitable (PRD §4.2)
});

export async function inviteMemberAction(input: z.infer<typeof inviteSchema>): Promise<ActionResult> {
  try {
    const parsed = inviteSchema.parse(input);
    await requireMembership(parsed.tenantId, "team");
    await auth.api.createInvitation({
      headers: await headers(),
      body: {
        organizationId: parsed.tenantId,
        email: parsed.email,
        role: parsed.role,
      },
    });
    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelInviteAction(tenantId: string, invitationId: string): Promise<ActionResult> {
  try {
    await requireMembership(tenantId, "team");
    await auth.api.cancelInvitation({
      headers: await headers(),
      body: { invitationId },
    });
    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const roleSchema = z.object({
  tenantId: z.string().min(1),
  memberId: z.string().min(1),
  role: z.enum(["admin", "billing", "member"]),
});

export async function updateMemberRoleAction(input: z.infer<typeof roleSchema>): Promise<ActionResult> {
  try {
    const parsed = roleSchema.parse(input);
    await requireMembership(parsed.tenantId, "team");
    const target = (await listMembers(parsed.tenantId)).find((m) => m.memberId === parsed.memberId);
    if (!target) throw new Error("Member not found");
    assertNotOwner(target.role, "given a different role");
    await auth.api.updateMemberRole({
      headers: await headers(),
      body: { organizationId: parsed.tenantId, memberId: parsed.memberId, role: parsed.role },
    });
    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeMemberAction(tenantId: string, memberId: string): Promise<ActionResult> {
  try {
    await requireMembership(tenantId, "team");
    const target = (await listMembers(tenantId)).find((m) => m.memberId === memberId);
    if (!target) throw new Error("Member not found");
    assertNotOwner(target.role, "removed");
    await auth.api.removeMember({
      headers: await headers(),
      body: { organizationId: tenantId, memberIdOrEmail: memberId },
    });
    revalidatePath("/team");
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
    void session;
    await transferOwnership(tenantId, toUserId);
    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------- Ops-only ----------

const createTenantSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().max(50).optional(),
  ownerEmail: z.string().email(),
});

export async function opsCreateTenantAction(input: z.infer<typeof createTenantSchema>): Promise<ActionResult> {
  try {
    await requireOps();
    const parsed = createTenantSchema.parse(input);
    const owner = await findUserByEmail(parsed.ownerEmail);
    if (!owner) {
      throw new Error(
        "No account exists for that email. Ask them to sign up first — the onboarding wizard arrives in a later milestone.",
      );
    }
    const slug = parsed.slug?.trim()
      ? await uniqueSlug(parsed.slug)
      : await uniqueSlug(parsed.name);
    await createTenantWithOwner({ name: parsed.name, slug, ownerUserId: owner.id });
    revalidatePath("/ops/tenants");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function opsSetTenantStatusAction(
  tenantId: string,
  status: "active" | "suspended" | "inactive",
): Promise<ActionResult> {
  try {
    await requireOps();
    await setTenantStatus(tenantId, status);
    revalidatePath("/ops/tenants");
    revalidatePath(`/ops/tenants/${tenantId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function opsDeleteTenantAction(tenantId: string, confirmSlug: string): Promise<ActionResult> {
  try {
    await requireOps();
    await deleteTenant(tenantId, confirmSlug);
    revalidatePath("/ops/tenants");
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
