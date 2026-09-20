"use client";

import { useState } from "react";
import { History } from "lucide-react";
import type { TimelineEntry } from "../service";
import { AUDIT_GROUPS, auditGroup, auditLabel, describeAudit, type AuditGroup } from "../kinds";
import { formatCents } from "@/lib/money";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { Section } from "@/components/section";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";

const fmt = { cents: formatCents };

/** An audit trail, newest first, filterable by group. */
export function ActivityFeed({
  entries,
  title = "Activity",
  emptyDescription = "Every ops action on this client lands here with who did it and when.",
}: {
  entries: TimelineEntry[];
  title?: string;
  emptyDescription?: string;
}) {
  const [group, setGroup] = useState<AuditGroup | "all">("all");
  const counts = new Map<AuditGroup, number>();
  for (const e of entries) counts.set(auditGroup(e.kind), (counts.get(auditGroup(e.kind)) ?? 0) + 1);
  const shown = group === "all" ? entries : entries.filter((e) => auditGroup(e.kind) === group);

  return (
    <Section
      title={title}
      icon={History}
      count={entries.length}
      actions={
        <div className="flex flex-wrap gap-1">
          {[{ key: "all" as const, label: "All" }, ...AUDIT_GROUPS.filter((g) => counts.get(g.key))].map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGroup(g.key)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${group === g.key ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              {g.label}
              {g.key !== "all" && <span className="ml-1 opacity-70">{counts.get(g.key)}</span>}
            </button>
          ))}
        </div>
      }
    >
      {shown.length === 0 ? (
        <EmptyState icon={History} title="No activity recorded" description={emptyDescription} />
      ) : (
        <ol className="flex flex-col divide-y rounded-lg border bg-card">
          {shown.map((e) => {
            const detail = describeAudit(e.kind, e.payload, fmt);
            return (
              <li key={e.id} className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm">
                <Badge variant="outline" className="text-[10px]">{AUDIT_GROUPS.find((g) => g.key === auditGroup(e.kind))?.label}</Badge>
                <div className="min-w-0">
                  <span className="text-heading">{auditLabel(e.kind)}</span>
                  {detail && <span className="text-muted-foreground"> — {detail}</span>}
                  <div className="text-xs text-muted-foreground" title={formatDateTime(e.createdAt)}>
                    {e.actorName ?? "System"} · {formatRelative(e.createdAt)} · {formatDateTime(e.createdAt)}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
