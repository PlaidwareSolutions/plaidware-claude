"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { OPS } from "@/lib/routes";
import { PLATFORM_ROLES } from "@/lib/roles";
import { requireOps } from "../../policy";
import { setPlatformRole } from "./service";

type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (e: unknown): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : "Failed" });

const setRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(PLATFORM_ROLES),
});

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
