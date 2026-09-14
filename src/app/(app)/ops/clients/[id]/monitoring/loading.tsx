import { Skeleton } from "@/components/ui/skeleton";

export default function ClientMonitoringLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  );
}
