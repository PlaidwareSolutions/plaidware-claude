"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { OPS } from "@/lib/routes";
import { PLATFORM_ROLES } from "@/lib/roles";
import { requireOps } from "../../policy";
import { createDeveloperAccount, sendPasswordSetup, setPlatformRole } from "./service";

type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Failed" });

const setRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(PLATFORM_ROLES),
});

const addDeveloperSchema = z.object({
  email: z.email().transform((s) => s.trim().toLowerCase()),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
});

export async function addDeveloperAction(
  input: z.input<typeof addDeveloperSchema>,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  try {
    const session = await requireOps();
    const p = addDeveloperSchema.parse(input);
    const { userId } = await createDeveloperAccount({ ...p, actorUserId: session.user.id });
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
