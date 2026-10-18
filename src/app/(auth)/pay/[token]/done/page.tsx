import { redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { AUTH } from "@/lib/routes";
import { completePayLink } from "@/modules/partners/api-service";

export const metadata = { title: "Payment received" };
export const dynamic = "force-dynamic";

/**
 * Stripe's return_url (and the in-page success path). Activation arrives by
 * webhook a few seconds later; the partner's billing page polls for it. A
 * failed redirect (3DS declined) goes back to the pay page to retry.
 */
export default async function PartnerPayDonePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ redirect_status?: string }>;
}) {
  const { token } = await params;
  const { redirect_status } = await searchParams;
  if (redirect_status === "failed") redirect(AUTH.pay(token));
  const successUrl = await completePayLink(token);
  if (successUrl) redirect(successUrl);
  return <EmptyState title="Link not found" description="Return to the app you came from." className="border-0 px-0 py-2" />;
}
