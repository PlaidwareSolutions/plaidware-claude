/**
 * Multi-product Client Setup Link smoke (Stripe TEST MODE, local DB).
 * One link covers Company Website + Digital Marketing: the client pays the
 * primary product once; the secondary is charged off-session to the saved
 * card by runFinalize. Run:
 *   node --env-file=.env --import tsx scripts/smoke-onboarding-multi.ts
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db";
import { getStripe } from "../src/lib/stripe";
import { organization, user } from "../src/modules/auth/schema";
import { products } from "../src/modules/catalog/schema";
import { subscriptions } from "../src/modules/billing/schema";
import { subscriptionProvisioning } from "../src/modules/provisioning/schema";
import { createCheckout } from "../src/modules/billing/service";
import {
  completeSetupPassword,
  createClientSetup,
  getSetupByToken,
  runFinalize,
} from "../src/modules/onboarding/service";

const stripe = getStripe();
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  const stamp = Date.now();
  const clientEmail = `multi_${stamp}@example.com`;
  const opsId = `ops_${stamp}`;
  await db.insert(user).values({
    id: opsId, name: "Ops Fixture", email: `${opsId}@example.com`, emailVerified: true,
    firstName: "Ops", lastName: "Fixture", phone: "+15550007777", platformRole: "ops_admin",
    createdAt: new Date(), updatedAt: new Date(),
  });

  const [web, dm] = await Promise.all([
    db.query.products.findFirst({ where: eq(products.slug, "company-website") }),
    db.query.products.findFirst({ where: eq(products.slug, "digital-marketing") }),
  ]);
  assert(web && dm, "company-website + digital-marketing exist");
  const comps = await db.query.productComponents.findMany();
  const byName = (productId: string, n: string) =>
    comps.find((c) => c.productId === productId && c.name === n)!;

  console.log("1) ops creates a TWO-product setup…");
  const setup = await createClientSetup({
    clientName: "Multi Smoke",
    clientEmail,
    tenantName: `Multi Smoke Co ${stamp}`,
    products: [
      {
        productId: web.id,
        items: [
          { componentId: byName(web.id, "Initial Build").id, priceCents: 100 },   // $1
          { componentId: byName(web.id, "Hosting").id, priceCents: 2500 },        // $25/mo
        ],
        domainUrl: "https://multi-smoke-site.com",
      },
      {
        productId: dm.id,
        items: [
          { componentId: byName(dm.id, "Onboarding & Strategy Audit").id, priceCents: 50000 }, // $500
          { componentId: byName(dm.id, "SEO Retainer").id, priceCents: 49900 },                // $499/mo
        ],
        domainUrl: null,
      },
    ],
    sendEmailToClient: false,
    actorUserId: opsId,
  });
  const token = setup.link.split("/welcome/")[1];

  console.log("2) proposal groups both products with combined totals…");
  const proposal = await getSetupByToken(token);
  assert(proposal?.products.length === 2, "two product groups");
  assert(proposal.primaryIndex === 0, "website (recurring) is primary");
  assert(proposal.products[0].dueTodayCents === 2600, `web due ${proposal.products[0].dueTodayCents}`);
  assert(proposal.products[1].dueTodayCents === 99900, `dm due ${proposal.products[1].dueTodayCents}`);
  assert(proposal.dueTodayCents === 2600 + 99900, `combined due ${proposal.dueTodayCents}`);

  console.log("3) client sets password + pays the PRIMARY product only…");
  await completeSetupPassword(token, "client-chosen-pw-1");
  const clientUser = await db.query.user.findFirst({ where: eq(user.email, clientEmail) });
  const co = await createCheckout({
    tenantId: proposal.tenantId,
    productId: web.id,
    componentIds: proposal.products[0].componentIds,
    contact: { email: clientEmail, name: "Multi Smoke" },
    userId: clientUser!.id,
  });
  assert(co.mode === "payment" && co.clientSecret, "primary payment secret");
  const pi = await stripe.paymentIntents.confirm(co.clientSecret!.split("_secret_")[0], {
    payment_method: "pm_card_visa",
  });
  assert(pi.status === "succeeded" && pi.amount === 2600, `primary charged ${pi.amount}`);
  // Simulate the invoice.paid webhook flip (no listener in the smoke env).
  await db.update(subscriptions).set({ status: "active" }).where(eq(subscriptions.id, co.subscriptionId));

  // M1/M4: the confirmed PM must be attached to the CUSTOMER for reuse.
  const org = await db.query.organization.findFirst({ where: eq(organization.id, proposal.tenantId) });
  assert(org?.stripeCustomerId, "stripe customer exists");
  const cards = await stripe.paymentMethods.list({ customer: org.stripeCustomerId!, type: "card" });
  assert(cards.data.length > 0, "card attached to customer after primary payment (M1)");

  console.log("4) runFinalize fans out — DM charged off-session…");
  const fin = await runFinalize(proposal.inviteId);
  assert(fin.state === "complete", `finalize state ${JSON.stringify(fin)}`);

  const subs = await db.query.subscriptions.findMany({
    where: and(
      eq(subscriptions.tenantId, proposal.tenantId),
      inArray(subscriptions.productId, [web.id, dm.id]),
    ),
  });
  assert(subs.length === 2, `2 local subscriptions, got ${subs.length}`);
  assert(subs.every((s) => s.status === "active" || s.status === "trialing"), "both live");
  const dmSub = subs.find((s) => s.productId === dm.id)!;
  assert(dmSub.stripeSubscriptionId, "dm has a stripe subscription");
  const dmInvoices = await stripe.invoices.list({ subscription: dmSub.stripeSubscriptionId!, limit: 1 });
  assert(dmInvoices.data[0]?.status === "paid", `dm first invoice ${dmInvoices.data[0]?.status} (M2)`);
  assert(dmInvoices.data[0]?.amount_paid === 99900, `dm paid ${dmInvoices.data[0]?.amount_paid}`);

  const customer = (await stripe.customers.retrieve(org.stripeCustomerId!)) as import("stripe").Stripe.Customer;
  assert(customer.invoice_settings?.default_payment_method, "customer default PM promoted");

  console.log("5) per-product domains + invite accepted + idempotent rerun…");
  const webProv = await db.query.subscriptionProvisioning.findFirst({
    where: eq(subscriptionProvisioning.subscriptionId, co.subscriptionId),
  });
  assert(webProv?.domainUrl === "https://multi-smoke-site.com", "web domain attached");
  const dmProv = await db.query.subscriptionProvisioning.findFirst({
    where: eq(subscriptionProvisioning.subscriptionId, dmSub.id),
  });
  assert(!dmProv?.domainUrl, "dm has no domain (none configured)");
  const after = await getSetupByToken(token);
  assert(after?.status === "accepted", "invite accepted");
  const again = await runFinalize(proposal.inviteId);
  assert(again.state === "complete", "rerun is a no-op");
  const subsAfter = await db.query.subscriptions.findMany({
    where: eq(subscriptions.tenantId, proposal.tenantId),
  });
  assert(subsAfter.length === 2, "rerun created nothing new");

  console.log("cleanup…");
  for (const s of subs) {
    if (s.stripeSubscriptionId) await stripe.subscriptions.cancel(s.stripeSubscriptionId).catch(() => {});
  }
  if (org.stripeCustomerId) await stripe.customers.del(org.stripeCustomerId).catch(() => {});
  await db.delete(organization).where(eq(organization.id, proposal.tenantId));
  await db.delete(user).where(eq(user.email, clientEmail));
  await db.delete(user).where(eq(user.id, opsId));

  console.log("\n✅ MULTI-PRODUCT SETUP SMOKE: ALL PASSED");
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("\n❌", e.message);
    await pool.end();
    process.exit(1);
  });
