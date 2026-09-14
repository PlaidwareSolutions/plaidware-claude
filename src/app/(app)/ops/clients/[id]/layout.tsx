import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { stripeTestMode } from "@/lib/stripe";
import { ClientHeader } from "@/modules/tenancy/components/client-header";
import { loadClient } from "./load";

export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireOpsPage();
  const { id } = await params;
  const client = await loadClient(id);
  if (!client) notFound();

  return (
    <div className="flex flex-col gap-6">
      <ClientHeader client={client} stripeTestMode={stripeTestMode()} />
      {children}
    </div>
  );
}
