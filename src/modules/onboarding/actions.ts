"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOps, requireUser } from "../../policy";
import {
  completeSetupPassword,
  createClientSetup,
  finalizeSetup,
  getSetupByToken,
  revokeSetup,
} from "./service";

const createSchema = z.object({
  clientName: z.string().min(2).max(100),
  clientEmail: z.string().email(),
  tenantName: z.string().min(2).max(80),
  productId: z.string().uuid(),
  items: z
    .array(z.object({ componentId: z.string().uuid(), priceCents: z.number().int().min(0).nullable() }))
    .min(1)
    .max(30),
  domainUrl: z.string().max(200).optional(),
  sendEmailToClient: z.boolean().default(false),
});

export async function createClientSetupAction(
  input: z.infer<typeof createSchema>,
): Promise<{ ok: true; link: string; tenantId: string } | { ok: false; error: string }> {
  try {
    const session = await requireOps();
    const p = createSchema.parse(input);
    const r = await createClientSetup({ ...p, actorUserId: session.user.id });
    revalidatePath("/ops/tenants");
    return { ok: true, link: r.link, tenantId: r.tenantId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Setup creation failed" };
  }
}

export async function completeSetupPasswordAction(
  token: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    z.string().min(8).max(200).parse(password);
    await completeSetupPassword(token, password);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Password setup failed" };
  }
}

export async function finalizeSetupAction(
  token: string,
  subscriptionId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireUser();
    const proposal = await getSetupByToken(token);
    if (!proposal) throw new Error("Setup link not found");
    if (proposal.clientEmail.toLowerCase() !== session.user.email.toLowerCase()) {
      throw new Error("This setup belongs to a different account");
    }
    await finalizeSetup(proposal.inviteId, subscriptionId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Finalize failed" };
  }
}

export async function revokeSetupAction(inviteId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireOps();
    await revokeSetup(inviteId);
    revalidatePath("/ops/tenants");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Revoke failed" };
  }
}
