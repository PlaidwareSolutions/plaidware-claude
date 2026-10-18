import { redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { getPayPage } from "@/modules/partners/api-service";
import { PayFlow } from "@/modules/partners/components/pay-flow";

export const metadata = { title: "Complete your payment" };
export const dynamic = "force-dynamic";

/** Partner API pay link: no Hub login — the token is the authorization. */
export default async function PartnerPayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = await getPayPage(token);

  if (page.state === "done") redirect(page.successUrl);
  if (page.state !== "pay") {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          title={page.state === "expired" ? "This payment link has expired" : "Link not found"}
          description="Go back to the app you came from and start the payment again — it will make a fresh link."
          className="border-0 px-0 py-2"
        />
        {page.state === "expired" && page.cancelUrl && (
          <a href={page.cancelUrl} className="text-center text-sm text-primary hover:underline">
            Return to the app
          </a>
        )}
      </div>
    );
  }

  return (
    <PayFlow token={token} page={page} publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""} />
  );
}
