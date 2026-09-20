"use server";

import { revalidateClientViews } from "@/lib/ops-revalidate";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { requireOps, requireUser } from "../../policy";
import { normalizePhone } from "../../lib/phone";
import { account, user } from "../auth/schema";
import { getUserTenants } from "../tenancy/queries";
import { needsPasswordSetup } from "./setup-rules";
import { createCheckout, type CheckoutResult } from "../billing/service";
import {
  applyInvitePricing,
  completeSetupPassword,
  createClientSetup,
  getSetupByToken,
  regenerateSetupLink,
  resendSetupLink,
  revokeSetup,
  runFinalize,
  type FinalizeState,
} from "./service";

const createSchema = z.object({
  clientName: z.string().min(2).max(100),
  clientEmail: z.string().email(),
  phone: z
    .string()
    .max(40)
    .optional()
    .refine((v) => !v || !!normalizePhone(v), "Enter a phone number with a country code"),
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
): Promise<
  { ok: true; link: string; tenantId: string; superseded: number; emailError: string | null } | { ok: false; error: string }
> {
  try {
    const session = await requireOps();
    const p = createSchema.parse(input);
    const r = await createClientSetup({ ...p, actorUserId: session.user.id });
    revalidateClientViews();
    return { ok: true, link: r.link, tenantId: r.tenantId, superseded: r.superseded, emailError: r.emailError };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Setup creation failed" };
  }
}

/**
 * Before the operator types a workspace name: does this email already have an
 * account, and would the setup attach to an existing workspace?
 */
export async function lookupClientEmailAction(
  email: string,
): Promise<
  | { ok: true; exists: false }
  | { ok: true; exists: true; name: string; needsPassword: boolean; workspace: { id: string; name: string } | null }
  | { ok: false; error: string }
> {
  try {
    await requireOps();
    const addr = z.string().email().parse(email.trim().toLowerCase());
    const existing = await db.query.user.findFirst({ where: eq(user.email, addr) });
    if (!existing) return { ok: true, exists: false };
    const [tenants, credential] = await Promise.all([
      getUserTenants(existing.id),
      db.query.account.findFirst({
        where: and(eq(account.userId, existing.id), eq(account.providerId, "credential")),
        columns: { password: true },
      }),
    ]);
    const owned = tenants.find((t) => t.role === "owner") ?? null;
    return {
      ok: true,
      exists: true,
      name: existing.name,
      needsPassword: needsPasswordSetup({ emailVerified: existing.emailVerified, credentialPassword: credential?.password }),
      workspace: owned ? { id: owned.id, name: owned.name } : null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Lookup failed" };
  }
}

/**
 * The client's "Continue to payment" on /welcome: commits the invite's held
 * prices as tenant overrides, then opens the primary product's checkout at
 * exactly the quoted amounts.
 */
export async function startSetupCheckoutAction(
  token: string,
): Promise<({ ok: true } & CheckoutResult) | { ok: false; error: string }> {
  try {
    const session = await requireUser();
    const proposal = await getSetupByToken(token);
    if (!proposal) throw new Error("Setup link not found");
    if (proposal.status !== "pending") throw new Error("This setup link is no longer active");
    if (proposal.clientEmail.toLowerCase() !== session.user.email.toLowerCase()) {
      throw new Error("This setup belongs to a different account");
    }
    await applyInvitePricing(proposal.inviteId, session.user.id);
    const primary = proposal.products[proposal.primaryIndex];
    const result = await createCheckout({
      tenantId: proposal.tenantId,
      productId: primary.productId,
      componentIds: primary.componentIds,
      contact: { email: session.user.email, name: session.user.name },
      skipAutoPromos: true, // the quoted price is the final price
      userId: session.user.id,
    });
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Checkout failed" };
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

/** Re-send the same /welcome link (no rotation). */
export async function resendSetupLinkAction(inviteId: string): Promise<{ ok: true; sentTo: string } | { ok: false; error: string }> {
  try {
    const session = await requireOps();
    z.string().uuid().parse(inviteId);
    const r = await resendSetupLink(inviteId, session.user.id);
    revalidateClientViews();
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not resend link" };
  }
}

/** Fresh /welcome link on the same invite; optionally emailed to the client. */
export async function regenerateSetupLinkAction(
  inviteId: string,
  opts: { emailClient?: boolean } = {},
): Promise<{ ok: true; link: string; sentTo: string | null; emailError: string | null } | { ok: false; error: string }> {
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
