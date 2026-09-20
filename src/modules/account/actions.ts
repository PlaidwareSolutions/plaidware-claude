"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { TENANT } from "@/lib/routes";
import { requireUser } from "../../policy";
import { emailChangeSchema, profileSchema, type ProfileInput } from "./contracts";
import { requestEmailChange, revokeOtherOwnSessions, revokeOwnSession, updateProfile } from "./service";

type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Check the form" };
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
}

export async function updateProfileAction(input: ProfileInput): Promise<ActionResult> {
  try {
    await requireUser();
    const p = profileSchema.parse(input);
    await updateProfile({ ...p, headers: await headers() });
    revalidatePath(TENANT.settings);
    revalidatePath("/", "layout"); // the shell shows the name
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  try {
    const s = await requireUser();
    await revokeOwnSession({
      userId: s.user.id,
      sessionId: z.string().min(1).parse(sessionId),
      currentSessionId: s.session.id,
    });
    revalidatePath(TENANT.settings);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeOtherSessionsAction(): Promise<{ ok: true; revoked: number } | { ok: false; error: string }> {
  try {
    const s = await requireUser();
    const { revoked } = await revokeOtherOwnSessions({ userId: s.user.id, currentSessionId: s.session.id });
    revalidatePath(TENANT.settings);
    return { ok: true, revoked };
  } catch (e) {
    return fail(e);
  }
}

export async function requestEmailChangeAction(input: { newEmail: string }): Promise<ActionResult> {
  try {
    const s = await requireUser();
    const { newEmail } = emailChangeSchema.parse(input);
    if (newEmail === s.user.email.toLowerCase()) throw new Error("That's already your email address.");
    await requestEmailChange({ userId: s.user.id, currentEmail: s.user.email, newEmail, headers: await headers() });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
