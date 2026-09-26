"use client";

import { useState } from "react";
import Link from "next/link";
import { WORK } from "@/lib/routes";
import { useAction } from "@/lib/use-action";
import { formatDate, formatDateTime } from "@/lib/dates";
import { Input } from "@/components/ui/input";
import { assignItemAction, moveItemAction, setItemRequesterAction, setItemSprintAction, updateItemAction } from "../../actions";
import type { WorkBoardMode } from "../../contracts";
import type { WorkItemDetailDto } from "../../dto";
import { parseLabels } from "../labels";
import { AssigneeSelect, PrioritySelect, RefSelect, SourceSelect, StatusSelect, TypeSelect } from "../pickers";

/** The field rail on the item page; every control saves on change. */
export function ItemSidebar({
  slug,
  mode,
  item,
  canLinkClient,
  tenants,
}: {
  slug: string;
  mode: WorkBoardMode;
  item: WorkItemDetailDto;
  canLinkClient: boolean;
  tenants: { id: string; name: string }[];
}) {
  const { run, isPending } = useAction();
  const busy = (k: string) => isPending(`field:${k}`);
  const save = (k: string, fn: () => Promise<{ ok: boolean }>) => run(fn as () => Promise<{ ok: true } | { ok: false; error?: string }>, { key: `field:${k}`, refresh: false });
  const patch = (k: string, p: Parameters<typeof updateItemAction>[0]["patch"]) => save(k, () => updateItemAction({ itemId: item.id, patch: p }));
  void slug;

  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
      <dl className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-sm">
        <Field label="Status">
          <StatusSelect value={item.status} disabled={busy("status")} className="w-full" onChange={(v) => void save("status", () => moveItemAction({ itemId: item.id, status: v }))} />
        </Field>
        <Field label="Type">
          <TypeSelect value={item.type} disabled={busy("type")} className="w-full" onChange={(v) => void patch("type", { type: v })} />
        </Field>
        <Field label="Priority">
          <PrioritySelect value={item.priority} disabled={busy("priority")} className="w-full" onChange={(v) => void patch("priority", { priority: v })} />
        </Field>
        <Field label="Assignee">
          <AssigneeSelect value={item.assignee?.id ?? null} assignees={item.assignees} disabled={busy("assignee")} className="w-full" onChange={(v) => void save("assignee", () => assignItemAction({ itemId: item.id, assigneeUserId: v }))} />
        </Field>
        {mode === "sprints" && (
          <Field label="Sprint">
            <RefSelect
              value={item.sprint?.id ?? null}
              options={[...item.sprints.map((s) => ({ id: s.id, name: `${s.name}${s.status === "active" ? " (active)" : ""}` })), ...(item.sprint && !item.sprints.some((s) => s.id === item.sprint!.id) ? [{ id: item.sprint.id, name: `${item.sprint.name} (${item.sprint.status})` }] : [])]}
              noneLabel="No sprint"
              disabled={busy("sprint")}
              className="w-full"
              ariaLabel="Sprint"
              onChange={(v) => void save("sprint", () => setItemSprintAction({ itemId: item.id, sprintId: v }))}
            />
          </Field>
        )}
        <Field label="Points">
          <NumberField value={item.estimatePoints} disabled={busy("points")} onSave={(v) => void patch("points", { estimatePoints: v })} />
        </Field>
        <Field label="Due">
          <Input type="date" defaultValue={item.dueOn ?? ""} disabled={busy("due")} className="h-8" aria-label="Due date" onChange={(e) => void patch("due", { dueOn: e.target.value || null })} />
        </Field>
        <Field label="Labels">
          <TextField value={item.labels.join(", ")} placeholder="auth, ui" disabled={busy("labels")} onSave={(v) => void patch("labels", { labels: parseLabels(v) })} />
        </Field>
        <Field label="Source">
          <SourceSelect value={item.source} disabled={busy("source")} className="w-full" onChange={(v) => void patch("source", { source: v })} />
        </Field>
        {!canLinkClient && item.requester && (
          <Field label="Requesting client" hint="Shown because you're on this client's workspace.">
            <Link href={WORK.client(item.requester.tenantId)} className="font-medium text-heading hover:text-primary">
              {item.requester.tenantName}
            </Link>
          </Field>
        )}
        {canLinkClient && (
          <Field label="Requesting client" hint="Developers see this only if they're on the client's workspace.">
            <RefSelect
              value={item.requester?.tenantId ?? null}
              options={tenants}
              noneLabel="None"
              disabled={busy("requester")}
              className="w-full"
              ariaLabel="Requesting client"
              onChange={(v) => void save("requester", () => setItemRequesterAction({ itemId: item.id, requesterTenantId: v }))}
            />
          </Field>
        )}
      </dl>
      <dl className="flex flex-col gap-1 px-1 text-xs text-muted-foreground">
        <div>Created {formatDate(item.createdAt)}{item.reporter ? ` by ${item.reporter.name}` : ""}</div>
        {item.startedAt && <div title={formatDateTime(item.startedAt)}>Started {formatDate(item.startedAt)}</div>}
        {item.completedAt && <div title={formatDateTime(item.completedAt)}>{item.status === "canceled" ? "Canceled" : "Completed"} {formatDate(item.completedAt)}</div>}
        <div title={formatDateTime(item.updatedAt)}>Updated {formatDate(item.updatedAt)}</div>
      </dl>
    </aside>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NumberField({ value, disabled, onSave }: { value: number | null; disabled: boolean; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  const commit = () => {
    const n = v.trim() === "" ? null : Number(v);
    if (n === value || (n != null && !Number.isFinite(n))) return;
    onSave(n);
  };
  return <Input type="number" min={0} max={100} value={v} disabled={disabled} className="h-8" aria-label="Estimate points" onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} placeholder="—" />;
}

function TextField({ value, placeholder, disabled, onSave }: { value: string; placeholder?: string; disabled: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const commit = () => {
    if (v.trim() === value.trim()) return;
    onSave(v);
  };
  return <Input value={v} disabled={disabled} className="h-8" aria-label="Labels" placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}
