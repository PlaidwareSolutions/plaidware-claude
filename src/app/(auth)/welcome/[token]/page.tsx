import { getSetupByToken } from "@/modules/onboarding/service";
import { WelcomeFlow } from "@/modules/onboarding/components/welcome-flow";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Complete your setup" };
export const dynamic = "force-dynamic";

export default async function WelcomePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const proposal = await getSetupByToken(token);

  if (!proposal) {
    return (
      <EmptyState
        title="Link not found"
        description="This setup link isn't valid. Ask your Plaidware contact to send a fresh one."
        className="border-0 px-0 py-2"
      />
    );
  }

  return (
    <WelcomeFlow
      token={token}
      proposal={proposal}
      publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""}
    />
  );
}
