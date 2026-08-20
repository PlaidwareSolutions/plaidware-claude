import { getSetupByToken } from "@/modules/onboarding/service";
import { WelcomeFlow } from "@/modules/onboarding/components/welcome-flow";

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
      <div className="flex flex-col gap-3 text-center">
        <h1 className="text-xl font-semibold text-heading">Link not found</h1>
        <p className="text-sm text-muted-foreground">
          This setup link isn&apos;t valid. Ask your Plaidware contact to send a
          fresh one.
        </p>
      </div>
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
