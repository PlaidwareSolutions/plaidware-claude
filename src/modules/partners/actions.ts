"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { OPS } from "@/lib/routes";
import { revalidateClientViews } from "@/lib/ops-revalidate";
import { requireOps } from "../../policy";
import {
  createPartnerApp,
  mintPartnerAppKey,
  removeTenantLinkByOps,
  revokePartnerAppKey,
  rotatePartnerWebhookSecret,
  setPartnerAppStatus,
  setTenantLinkByOps,
  updatePartnerApp,
} from "./service";

type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({
  ok: false,
  error: e instanceof Error ? e.message : "Something went wrong",
});

const list = z.array(z.string().trim().max(200)).max(20);
const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .transform((v) => v || null)
  .nullable();

const appSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  productPrefixes: list,
  webhookUrl: optionalUrl,
  provisionUrl: optionalUrl,
  billingUrl: optionalUrl,
  allowedReturnOrigins: list,
});

export async function createPartnerAppAction(
  input: z.infer<typeof appSchema> & { name: string },
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requireOps("admin");
    const name = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/, "Name: 2–40 lowercase letters, digits or dashes").parse(input.name);
    const id = await createPartnerApp({ ...appSchema.parse(input), name }, session.user.id);
    revalidatePath(OPS.partners);
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function updatePartnerAppAction(id: string, input: z.infer<typeof appSchema>): Promise<ActionResult> {
  try {
    const session = await requireOps("admin");
    await updatePartnerApp(z.string().uuid().parse(id), appSchema.parse(input), session.user.id);
    revalidatePath(OPS.partners);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setPartnerAppStatusAction(id: string, status: "active" | "disabled"): Promise<ActionResult> {
  try {
    const session = await requireOps("admin");
    await setPartnerAppStatus(z.string().uuid().parse(id), z.enum(["active", "disabled"]).parse(status), session.user.id);
    revalidatePath(OPS.partners);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function rotatePartnerSecretAction(id: string): Promise<ActionResult<{ secret: string }>> {
  try {
    const session = await requireOps("admin");
    const secret = await rotatePartnerWebhookSecret(z.string().uuid().parse(id), session.user.id);
    revalidatePath(OPS.partners);
    return { ok: true, secret };
  } catch (e) {
    return fail(e);
  }
}

export async function mintPartnerKeyAction(id: string, label: string): Promise<ActionResult<{ raw: string }>> {
  try {
    const session = await requireOps("admin");
    const minted = await mintPartnerAppKey(z.string().uuid().parse(id), z.string().max(80).parse(label), session.user.id);
    revalidatePath(OPS.partners);
    return { ok: true, raw: minted.raw };
  } catch (e) {
    return fail(e);
  }
}

export async function revokePartnerKeyAction(keyId: string): Promise<ActionResult> {
  try {
    const session = await requireOps("admin");
    await revokePartnerAppKey(z.string().uuid().parse(keyId), session.user.id);
    revalidatePath(OPS.partners);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setPartnerLinkAction(tenantId: string, appId: string, externalTenantId: string): Promise<ActionResult> {
  try {
    const session = await requireOps("admin");
    await setTenantLinkByOps({
      partnerAppId: z.string().uuid().parse(appId),
      tenantId: z.string().min(1).parse(tenantId),
      externalTenantId: z.string().trim().min(1).max(200).parse(externalTenantId),
      actorUserId: session.user.id,
    });
    revalidateClientViews(tenantId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removePartnerLinkAction(tenantId: string, appId: string): Promise<ActionResult> {
  try {
    const session = await requireOps("admin");
    await removeTenantLinkByOps({ partnerAppId: z.string().uuid().parse(appId), tenantId, actorUserId: session.user.id });
    revalidateClientViews(tenantId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
