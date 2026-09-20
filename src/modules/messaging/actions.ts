"use server";

import { revalidatePath } from "next/cache";
import { OPS, TENANT } from "@/lib/routes";
import { z } from "zod";
import { requireMembership, requireOps } from "../../policy";
import { closeThread, createThread, getThreadTenantId, replyToThread } from "./service";

type R = { ok: boolean; error?: string };
const fail = (e: unknown): R => ({ ok: false, error: e instanceof Error ? e.message : "Failed" });

const createSchema = z.object({
  tenantId: z.string().min(1),
  subject: z.string().min(2).max(150),
  body: z.string().min(1).max(5000),
  subscriptionId: z.string().uuid().nullable().optional(),
});

export async function createThreadAction(input: z.infer<typeof createSchema>): Promise<R> {
  try {
    const p = createSchema.parse(input);
    // Messaging support is a read-level right: every member, in any
    // workspace status, can ask Plaidware for help.
    const { session, role } = await requireMembership(p.tenantId, "read");
    await createThread({
      tenantId: p.tenantId,
      subject: p.subject,
      body: p.body,
      senderUserId: session.user.id,
      senderRole: role === "ops" ? "ops" : "tenant",
      subscriptionId: p.subscriptionId,
    });
    revalidatePath(TENANT.inbox);
    revalidatePath(OPS.inbox);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function replyAction(threadId: string, body: string): Promise<R> {
  try {
    const tenantId = await getThreadTenantId(threadId);
    if (!tenantId) throw new Error("Thread not found");
    const { session, role } = await requireMembership(tenantId, "read");
    await replyToThread({
      threadId,
      body: z.string().min(1).max(5000).parse(body),
      senderUserId: session.user.id,
      senderRole: role === "ops" ? "ops" : "tenant",
    });
    revalidatePath(TENANT.inbox);
    revalidatePath(OPS.inbox);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function closeThreadAction(threadId: string): Promise<R> {
  try {
    await requireOps();
    await closeThread(threadId);
    revalidatePath(OPS.inbox);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
