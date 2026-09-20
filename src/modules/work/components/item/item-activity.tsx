import { History } from "lucide-react";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import type { WorkEventDto } from "../../dto";
import { describeWorkEvent, workEventGroup, workEventLabel } from "../../event-kinds";

/** The item's history, newest first (same shape as the client Activity tab). */
export function ItemActivity({ events }: { events: WorkEventDto[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <History className="size-4" /> History
        {events.length > 0 && <span className="text-xs font-normal">{events.length}</span>}
      </h2>
      {events.length === 0 ? (
        <EmptyState compact icon={History} title="No history yet" />
      ) : (
        <ol className="flex flex-col divide-y rounded-lg border bg-card">
          {events.map((e) => {
            const detail = describeWorkEvent(e.kind, e.payload);
            return (
              <li key={e.id} className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm">
                <Badge variant="outline" className="text-[10px]">{workEventGroup(e.kind)}</Badge>
                <div className="min-w-0">
                  <span className="text-heading">{workEventLabel(e.kind)}</span>
                  {detail && <span className="text-muted-foreground"> — {detail}</span>}
                  <div className="text-xs text-muted-foreground" title={formatDateTime(e.createdAt)}>
                    {e.actor?.name ?? "System"} · {formatRelative(e.createdAt)}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
