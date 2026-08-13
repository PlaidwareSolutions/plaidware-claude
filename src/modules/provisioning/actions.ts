"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMembership, requireOps } from "../../policy";
import { getSubscriptionForTenant } from "../billing/queries";
import {
  deleteCredential,
  revealCredentialSecret,
  runDnsVerification,
  setDomain,
  setVerificationConfig,
  upsertCredential,
} from "./service";

type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (e: unknown): ActionResult => ({
  ok: false,
  error: e instanceof Error ? e.message : "Something went wrong",
});

const domainSchema = z.object({
  tenantId: z.string().min(1),
  subscriptionId: z.string().uuid(),
  domainUrl: z
    .string()
    .max(200)
    .regex(/^[a-zA-Z0-9.:/_-]*$/)
    .nullable(),
});

/** Tenant (write role) or ops set the live domain. */
export async function setDomainAction(input: z.infer<typeof domainSchema>): Promise<ActionResult> {
  try {
    const p = domainSchema.parse(input);
    const { session } = await requireMembership(p.tenantId, "write");
    const sub = await getSubscriptionForTenant(p.subscriptionId, p.tenantId);
    if (!sub) throw new Error("Subscription not found");
    await setDomain(p.subscriptionId, p.domainUrl?.trim() || null, session.user.id);
    revalidatePath("/billing");
    revalidatePath(`/ops/tenants/${p.tenantId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const verifyConfigSchema = z.object({
  subscriptionId: z.string().uuid(),
  verifyToken: z.string().max(100).nullable(),
  expectedCname: z.string().max(200).nullable(),
  expectedAIps: z.string().max(300).nullable(),
});

export async function setVerifyConfigAction(
  input: z.infer<typeof verifyConfigSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireOps();
    const p = verifyConfigSchema.parse(input);
    await setVerificationConfig(
      p.subscriptionId,
      { verifyToken: p.verifyToken, expectedCname: p.expectedCname, expectedAIps: p.expectedAIps },
      session.user.id,
    );
    revalidatePath("/ops/tenants");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function runDnsVerifyAction(
  subscriptionId: string,
): Promise<{ ok: true; passed: boolean; mode: string; detail: string } | { ok: false; error: string }> {
  try {
    const session = await requireOps();
    const r = await runDnsVerification(subscriptionId, session.user.id);
    revalidatePath("/ops/tenants");
    return { ok: true, passed: r.ok, mode: r.mode, detail: r.detail };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Verification failed" };
  }
}

const credentialSchema = z.object({
  id: z.string().uuid().optional(),
  subscriptionId: z.string().uuid(),
  kind: z.enum(["registrar", "dns", "email", "hosting", "other"]),
  label: z.string().min(1).max(80),
  url: z.string().max(300).optional(),
  username: z.string().max(200).optional(),
  secret: z.string().max(500).optional(),
});

export async function upsertCredentialAction(
  input: z.infer<typeof credentialSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireOps();
    const p = credentialSchema.parse(input);
    await upsertCredential({
      ...p,
      secret: p.secret || null,
      actorUserId: session.user.id,
    });
    revalidatePath("/ops/tenants");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteCredentialAction(credentialId: string): Promise<ActionResult> {
  try {
    const session = await requireOps();
    await deleteCredential(credentialId, session.user.id);
    revalidatePath("/ops/tenants");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function revealCredentialAction(
  credentialId: string,
): Promise<{ ok: true; secret: string } | { ok: false; error: string }> {
  try {
    const session = await requireOps();
    const secret = await revealCredentialSecret(credentialId, session.user.id);
    return { ok: true, secret };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reveal failed" };
  }
}
