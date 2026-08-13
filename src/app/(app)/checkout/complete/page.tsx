import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { getSession } from "@/policy";
import { getUserTenants } from "@/modules/tenancy/queries";
import { getSubscriptionForTenant } from "@/modules/billing/queries";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Order complete" };
export const dynamic = "force-dynamic";

export default async function CheckoutCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ subscription?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { subscription: subscriptionId } = await searchParams;
  if (!subscriptionId) redirect("/billing");

  const tenants = await getUserTenants(session.user.id);
  let sub = null;
  for (const t of tenants) {
    sub = await getSubscriptionForTenant(subscriptionId, t.id);
    if (sub) break;
  }

  const trialing = sub?.status === "trialing";

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-16 text-center">
      <CheckCircle2 className="size-12 text-success" />
      <h1 className="text-2xl font-semibold text-heading">
        {trialing ? "Your trial has started" : "Order received"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {trialing
          ? "Your free trial is active — your card will be charged automatically when it ends, and we'll email you 3 days before."
          : "Payment is processing. Your subscription activates the moment it settles (usually within seconds), and a confirmation email is on its way."}
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/billing">View billing</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
