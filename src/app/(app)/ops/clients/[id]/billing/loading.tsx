import { Skeleton } from "@/components/ui/skeleton";

/** Stripe is read live for every subscription — show structure while it answers. */
export default function ClientBillingLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-36 w-full rounded-lg" />
        <Skeleton className="h-36 w-full rounded-lg" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    </div>
  );
}
