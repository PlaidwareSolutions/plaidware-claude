"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { OPS } from "@/lib/routes";
import { revalidateUserViews } from "@/lib/ops-revalidate";
import { PLATFORM_ROLES } from "@/lib/roles";
import { getSession, requireOps } from "../../policy";
import { STAFF_ROLES } from "./rules";
import {
  createStaffAccount,
  revokeAllSessions,
  revokeSession,
  sendPasswordSetup,
  setAccountDisabled,
  setPlatformRole,
} from "./service";

type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Failed" });

const setRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(PLATFORM_ROLES),
});

const addStaffSchema = z.object({
  email: z.email().transform((s) => s.trim().toLowerCase()),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  role: z.enum(STAFF_ROLES),
});

export async function addStaffAction(
  input: z.input<typeof addStaffSchema>,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  try {
    const session = await requireOps();
    const p = addStaffSchema.parse(input);
    const { userId } = await createStaffAccount({ ...p, actorUserId: session.user.id });
    revalidatePath(OPS.access);
    return { ok: true, userId };
  } catch (e) {
    return fail(e);
  }
}

export async function sendPasswordSetupAction(userId: string): Promise<ActionResult> {
  try {
    await requireOps();
    await sendPasswordSetup({ userId: z.string().min(1).parse(userId) });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const disableSchema = z.object({
  userId: z.string().min(1),
  disabled: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export async function setAccountDisabledAction(input: z.infer<typeof disableSchema>): Promise<ActionResult> {
  try {
    const session = await requireOps();
    const p = disableSchema.parse(input);
    await setAccountDisabled({ ...p, reason: p.reason ?? null, actorUserId: session.user.id });
    revalidateUserViews(p.userId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeSessionAction(input: { userId: string; sessionId: string }): Promise<ActionResult> {
  try {
    const actor = await requireOps();
    const p = z.object({ userId: z.string().min(1), sessionId: z.string().min(1) }).parse(input);
    const current = await getSession();
    await revokeSession({ ...p, actorUserId: actor.user.id, currentSessionId: current?.session.id ?? "" });
    revalidateUserViews(p.userId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeAllSessionsAction(userId: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const actor = await requireOps();
    const id = z.string().min(1).parse(userId);
    const { count } = await revokeAllSessions({ userId: id, actorUserId: actor.user.id });
    revalidateUserViews(id);
    return { ok: true, count };
  } catch (e) {
    return fail(e);
  }
}

export async function setPlatformRoleAction(input: z.infer<typeof setRoleSchema>): Promise<ActionResult> {
  try {
    const session = await requireOps();
    const p = setRoleSchema.parse(input);
    await setPlatformRole({ ...p, actorUserId: session.user.id });
    revalidatePath(OPS.access);
    revalidatePath(OPS.home);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
