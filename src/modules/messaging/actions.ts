"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { requireMembership, requireOps, requireUser, isOps } from "../../policy";
import { messageThreads } from "./schema";
import { closeThread, createThread, replyToThread } from "./service";

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
    const session = await requireUser();
    const ops = isOps(session);
    if (!ops) await requireMembership(p.tenantId, "write");
    await createThread({
      tenantId: p.tenantId,
      subject: p.subject,
      body: p.body,
      senderUserId: session.user.id,
      senderRole: ops ? "ops" : "tenant",
      subscriptionId: p.subscriptionId,
    });
    revalidatePath("/inbox");
    revalidatePath("/ops/inbox");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function replyAction(threadId: string, body: string): Promise<R> {
  try {
    const session = await requireUser();
    const thread = await db.query.messageThreads.findFirst({
      where: eq(messageThreads.id, threadId),
    });
    if (!thread) throw new Error("Thread not found");
    const ops = isOps(session);
    if (!ops) await requireMembership(thread.tenantId, "write");
    await replyToThread({
      threadId,
      body: z.string().min(1).max(5000).parse(body),
      senderUserId: session.user.id,
      senderRole: ops ? "ops" : "tenant",
    });
    revalidatePath("/inbox");
    revalidatePath("/ops/inbox");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function closeThreadAction(threadId: string): Promise<R> {
  try {
    await requireOps();
    await closeThread(threadId);
    revalidatePath("/ops/inbox");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
