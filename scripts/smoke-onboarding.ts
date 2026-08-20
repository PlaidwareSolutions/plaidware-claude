/**
 * Client Setup Link smoke (Stripe TEST MODE, local DB).
 * Ops prepares → client sets password → locked checkout at custom prices →
 * payment → finalize (accepted + domain). Run:
 *   node --env-file=.env --import tsx scripts/smoke-onboarding.ts
 */
import { eq, and } from "drizzle-orm";
import { db, pool } from "../src/db";
import { auth } from "../src/lib/auth";
import { getStripe } from "../src/lib/stripe";
import { organization, user } from "../src/modules/auth/schema";
import { products } from "../src/modules/catalog/schema";
import { subscriptions, subscriptionItems } from "../src/modules/billing/schema";
import { subscriptionProvisioning } from "../src/modules/provisioning/schema";
import { createCheckout } from "../src/modules/billing/service";
import {
  completeSetupPassword,
  createClientSetup,
  finalizeSetup,
  getSetupByToken,
} from "../src/modules/onboarding/service";

const stripe = getStripe();
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  const stamp = Date.now();
  const clientEmail = `setup_${stamp}@example.com`;

  // Ops actor fixture
  const opsId = `ops_${stamp}`;
  await db.insert(user).values({
    id: opsId, name: "Ops Fixture", email: `${opsId}@example.com`, emailVerified: true,
    firstName: "Ops", lastName: "Fixture", phone: "+15550007777", platformRole: "ops_admin",
    createdAt: new Date(), updatedAt: new Date(),
  });

  const custom = await db.query.products.findFirst({ where: eq(products.slug, "custom-application") });
  assert(custom, "custom-application product exists");
  const comps = await db.query.productComponents.findMany();
  const byName = (n: string) => comps.find((c) => c.productId === custom.id && c.name === n)!;

  console.log("1) ops creates the setup (custom domain price $22, build $1)…");
  const setup = await createClientSetup({
    clientName: "Setup Smoke",
    clientEmail,
    tenantName: `Setup Smoke Co ${stamp}`,
    productId: custom.id,
    items: [
      { componentId: byName("Website Hosting").id, priceCents: null },
      { componentId: byName("Application Hosting").id, priceCents: null },
      { componentId: byName("Domain Renewal").id, priceCents: 2200 },
      { componentId: byName("Website Application Build").id, priceCents: 100 },
    ],
    domainUrl: "https://smoke-client-site.com",
    sendEmailToClient: false,
    actorUserId: opsId,
  });
  const token = setup.link.split("/welcome/")[1];
  assert(token?.length === 48, "raw token in link");

  console.log("2) proposal resolves with custom prices…");
  const proposal = await getSetupByToken(token);
  assert(proposal?.status === "pending" && proposal.needsPassword, "pending + needs password");
  assert(proposal.dueTodayCents === 3500 + 4500 + 2200 + 100, `due today ${proposal.dueTodayCents}`);
  const domainLine = proposal.lines.find((l) => l.name === "Domain Renewal");
  assert(domainLine?.amountCents === 2200, "domain at $22 custom");

  console.log("3) client sets password (verifies account)…");
  await completeSetupPassword(token, "client-chosen-pw-1");
  const clientUser = await db.query.user.findFirst({ where: eq(user.email, clientEmail) });
  assert(clientUser?.emailVerified, "email verified via link");
  const signIn = await auth.api.signInEmail({
    body: { email: clientEmail, password: "client-chosen-pw-1" },
  });
  assert(signIn.token, "new password signs in");
  let again = true;
  try { await completeSetupPassword(token, "second-try-pw"); } catch { again = false; }
  assert(!again, "password step refuses once verified");

  console.log("4) locked checkout at the invite's selection + prices…");
  const co = await createCheckout({
    tenantId: proposal.tenantId,
    productId: custom.id,
    componentIds: proposal.componentIds,
    contact: { email: clientEmail, name: "Setup Smoke" },
    userId: clientUser!.id,
  });
  assert(co.mode === "payment" && co.clientSecret, "payment secret returned");
  const pi = await stripe.paymentIntents.confirm(co.clientSecret!.split("_secret_")[0], {
    payment_method: "pm_card_visa",
  });
  assert(pi.status === "succeeded" && pi.amount === 10300, `charged ${pi.amount}, expected 10300`);

  console.log("5) finalize → accepted + domain attached…");
  await finalizeSetup(proposal.inviteId, co.subscriptionId);
  const after = await getSetupByToken(token);
  assert(after?.status === "accepted", "invite accepted");
  const prov = await db.query.subscriptionProvisioning.findFirst({
    where: eq(subscriptionProvisioning.subscriptionId, co.subscriptionId),
  });
  assert(prov?.domainUrl === "https://smoke-client-site.com", "domain attached");
  const items = await db.query.subscriptionItems.findMany({
    where: eq(subscriptionItems.subscriptionId, co.subscriptionId),
  });
  assert(items.find((i) => i.name === "Domain Renewal")?.amountCents === 2200, "item snapshot at custom price");
  assert(items.find((i) => i.name === "Website Application Build")?.amountCents === 100, "build at $1");

  console.log("cleanup…");
  const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, co.subscriptionId) });
  if (sub?.stripeSubscriptionId) await stripe.subscriptions.cancel(sub.stripeSubscriptionId).catch(() => {});
  const org = await db.query.organization.findFirst({ where: eq(organization.id, proposal.tenantId) });
  if (org?.stripeCustomerId) await stripe.customers.del(org.stripeCustomerId).catch(() => {});
  await db.delete(organization).where(eq(organization.id, proposal.tenantId));
  await db.delete(user).where(and(eq(user.email, clientEmail)));
  await db.delete(user).where(eq(user.id, opsId));

  console.log("\n✅ CLIENT SETUP LINK SMOKE: ALL PASSED");
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("\n❌", e.message);
    await pool.end();
    process.exit(1);
  });
