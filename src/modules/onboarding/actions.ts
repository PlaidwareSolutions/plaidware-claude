"use server";

import { revalidateClientViews } from "@/lib/ops-revalidate";
import { z } from "zod";
import { requireOps, requireUser } from "../../policy";
import {
  completeSetupPassword,
  createClientSetup,
  getSetupByToken,
  regenerateSetupLink,
  revokeSetup,
  runFinalize,
  type FinalizeState,
} from "./service";

const createSchema = z.object({
  clientName: z.string().min(2).max(100),
  clientEmail: z.string().email(),
  tenantName: z.string().min(2).max(80),
  products: z
    .array(
      z.object({
        productId: z.string().uuid(),
        items: z
          .array(
            z.object({ componentId: z.string().uuid(), priceCents: z.number().int().min(0).nullable() }),
          )
          .min(1)
          .max(30),
        domainUrl: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(5)
    .refine(
      (ps) => new Set(ps.map((p) => p.productId)).size === ps.length,
      "Each product can appear only once",
    ),
  sendEmailToClient: z.boolean().default(false),
});

export async function createClientSetupAction(
  input: z.infer<typeof createSchema>,
): Promise<{ ok: true; link: string; tenantId: string } | { ok: false; error: string }> {
  try {
    const session = await requireOps();
    const p = createSchema.parse(input);
    const r = await createClientSetup({ ...p, actorUserId: session.user.id });
    revalidateClientViews();
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
): Promise<({ ok: true } & FinalizeState) | { ok: false; error: string }> {
  try {
    const session = await requireUser();
    const proposal = await getSetupByToken(token);
    if (!proposal) throw new Error("Setup link not found");
    if (proposal.clientEmail.toLowerCase() !== session.user.email.toLowerCase()) {
      throw new Error("This setup belongs to a different account");
    }
    const state = await runFinalize(proposal.inviteId);
    return { ok: true, ...state };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Finalize failed" };
  }
}

export async function revokeSetupAction(inviteId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireOps();
    z.string().uuid().parse(inviteId);
    await revokeSetup(inviteId, session.user.id);
    revalidateClientViews();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Revoke failed" };
  }
}

/** Fresh /welcome link on the same invite; optionally emailed to the client. */
export async function regenerateSetupLinkAction(
  inviteId: string,
  opts: { emailClient?: boolean } = {},
): Promise<{ ok: true; link: string; sentTo: string | null } | { ok: false; error: string }> {
  try {
    const session = await requireOps();
    z.string().uuid().parse(inviteId);
    const r = await regenerateSetupLink(inviteId, session.user.id, opts);
    revalidateClientViews();
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not regenerate link" };
  }
}
