"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { env } from "../../env";
import { requireMembership, requireUser } from "../../policy";
import { getUserTenants } from "../tenancy/queries";
import { createTenantWithOwner, uniqueSlug } from "../tenancy/service";
import {
  cancelSubscription,
  createBillingPortalSession,
  createCheckout,
  type CheckoutResult,
} from "./service";
import { getSubscriptionForTenant } from "./queries";

const checkoutSchema = z.object({
  productId: z.string().uuid(),
  componentIds: z.array(z.string().uuid()).max(30),
});

export type CheckoutActionResult =
  | ({ ok: true } & CheckoutResult)
  | { ok: false; error: string };

export async function createCheckoutAction(
  input: z.infer<typeof checkoutSchema>,
): Promise<CheckoutActionResult> {
  try {
    const parsed = checkoutSchema.parse(input);
    const session = await requireUser();

    // Resolve the buyer's tenant; first purchase auto-creates one (PRD §4.2).
    const tenants = await getUserTenants(session.user.id);
    let tenant =
      tenants.find((t) => t.id === session.session.activeOrganizationId) ??
      tenants[0] ??
      null;
    if (tenant && !["owner", "admin"].includes(tenant.role)) {
      return { ok: false, error: "Ask a workspace owner or admin to make purchases." };
    }
    if (!tenant) {
      const name =
        `${session.user.name}'s workspace`.length > 60
          ? "My workspace"
          : `${session.user.name}'s workspace`;
      const slug = await uniqueSlug(session.user.email.split("@")[0]);
      const org = await createTenantWithOwner({
        name,
        slug,
        ownerUserId: session.user.id,
      });
      tenant = { id: org.id, name: org.name, slug: org.slug ?? slug, status: "active", role: "owner" };
    }

    const result = await createCheckout({
      tenantId: tenant.id,
      productId: parsed.productId,
      componentIds: parsed.componentIds,
      contact: { email: session.user.email, name: session.user.name },
    });
    revalidatePath("/billing");
    revalidatePath("/dashboard");
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Checkout failed" };
  }
}

export async function billingPortalAction(
  tenantId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    await requireMembership(tenantId, "billing");
    const url = await createBillingPortalSession(
      tenantId,
      `${env.APP_BASE_URL}/billing`,
    );
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Portal unavailable" };
  }
}

export async function cancelSubscriptionAction(
  tenantId: string,
  subscriptionId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireMembership(tenantId, "write");
    const sub = await getSubscriptionForTenant(subscriptionId, tenantId);
    if (!sub) throw new Error("Subscription not found");
    await cancelSubscription(subscriptionId);
    revalidatePath("/billing");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Cancel failed" };
  }
}
