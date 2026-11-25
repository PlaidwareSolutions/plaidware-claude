"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, ChevronDown, Copy, Flag, Link2, MoreHorizontal, Paperclip, Trash2 } from "lucide-react";
import { WORK } from "@/lib/routes";
import { useAction } from "@/lib/use-action";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { assignItemAction, setItemParentAction, setItemRequesterAction, setItemSprintAction, updateItemAction } from "../../actions";
import type { WorkBoardMode } from "../../contracts";
import type { WorkItemDetailDto, WorkUserRef } from "../../dto";
import { parseLabels } from "../labels";
import { AssigneeSelect, PrioritySelect, RefSelect, SourceSelect, TypeSelect } from "../pickers";
import { RESOLUTION_LABELS } from "../../transitions";
import { useWorkTransitions } from "../transition-host";
import { StatusButton } from "./status-button";
import { WatchButton } from "./watch-button";

const FIELD = "h-8 w-full justify-start px-2";
const GHOST_INPUT = "h-8 rounded-[3px] border-transparent bg-transparent px-2 shadow-none hover:bg-accent focus-visible:border-info focus-visible:bg-background focus-visible:ring-0 dark:bg-transparent";

/** Jira's right rail: status button, a collapsible Details panel of inline-edit rows, then dates. Every control saves on change. */
export function ItemSidebar({
  mode,
  item,
  canLinkClient,
  tenants,
  viewer,
  onDelete,
  onAttach,
  onLink,
  onClone,
  onMove,
  className,
}: {
  mode: WorkBoardMode;
  item: WorkItemDetailDto;
  canLinkClient: boolean;
  tenants: { id: string; name: string }[];
  viewer: WorkUserRef | null;
  /** Ops admins: the ⋯ menu's Delete. */
  onDelete?: () => void;
  onAttach: () => void;
  onLink: () => void;
  onClone: () => void;
  onMove: () => void;
  className?: string;
}) {
  const { run, isPending } = useAction();
  // null = the default: open on desktop, collapsed on phones (CSS, so no hydration flash); a tap decides from then on.
  const [open, setOpen] = useState<boolean | null>(null);
  const busy = (k: string) => isPending(`field:${k}`);
  const save = (k: string, fn: () => Promise<{ ok: boolean }>) => run(fn as () => Promise<{ ok: true } | { ok: false; error?: string }>, { key: `field:${k}`, refresh: false });
  const patch = (k: string, p: Parameters<typeof updateItemAction>[0]["patch"]) => save(k, () => updateItemAction({ itemId: item.id, patch: p }));
  const assign = (id: string | null) => void save("assignee", () => assignItemAction({ itemId: item.id, assigneeUserId: id }));
  const transitions = useWorkTransitions();
  const subject = { id: item.id, key: item.key, type: item.type, status: item.status, title: item.title };
  // Who, from the history (newest first): the person, else the app that filed it ("Fixorata").
  const who = (e: (typeof item.events)[number] | undefined) => e?.actor?.name ?? (typeof e?.payload.via === "string" ? e.payload.via : null);
  const createdBy = who(item.events.find((e) => e.kind === "item_created")) ?? item.reporter?.name ?? null;
  const updatedBy = who(item.events[0]);

  return (
    <aside className={cn("flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:self-start", className)}>
      <div className="flex items-center gap-2">
        <StatusButton status={item.status} onChange={(v) => void transitions.move(subject, v)} />
        <span className="ml-auto" />
        <WatchButton itemId={item.id} watchers={item.watchers} viewer={viewer} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 cursor-pointer rounded-[3px]" aria-label="More actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => void transitions.flag(subject, !item.flag)}>
              <Flag className={cn("size-4", !item.flag && "fill-warning text-warning")} /> {item.flag ? "Remove flag" : "Add flag"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onAttach}>
              <Paperclip className="size-4" /> Attach files
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onLink}>
              <Link2 className="size-4" /> Link issue
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onClone}>
              <Copy className="size-4" /> Clone
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onMove}>
              <ArrowRightLeft className="size-4" /> Move
            </DropdownMenuItem>
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 className="size-4" /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {item.flag && (
        <div className="flex items-start gap-2 rounded-[3px] border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <Flag className="mt-0.5 size-4 shrink-0 fill-warning text-warning" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-foreground">Flagged</div>
            {item.flag.reason && <div className="text-muted-foreground">{item.flag.reason}</div>}
            <div className="text-xs text-muted-foreground" title={formatDateTime(item.flag.at)}>
              {formatRelative(item.flag.at)}
            </div>
          </div>
          <button type="button" className="text-xs font-medium text-info hover:underline" onClick={() => void transitions.flag(subject, false)}>
            Remove
          </button>
        </div>
      )}

      <div className="rounded-[3px] border">
        <button
          type="button"
          onClick={() => setOpen((v) => (v === null ? !window.matchMedia("(min-width: 1024px)").matches : !v))}
          aria-expanded={open !== false}
          className="flex w-full items-center justify-between border-b px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-accent/50"
        >
          Details
          <ChevronDown className={cn("size-4 transition-transform", open === false && "-rotate-90", open === null && "max-lg:-rotate-90")} />
        </button>
        {open !== false && (
          <dl className={cn("flex flex-col gap-1 p-3 text-sm", open === null && "max-lg:hidden")}>
            <Row label="Assignee">
              <AssigneeSelect ghost value={item.assignee?.id ?? null} assignees={item.assignees} disabled={busy("assignee")} className={FIELD} onChange={assign} />
              {viewer && item.assignee?.id !== viewer.id && (
                <button type="button" className="mt-0.5 px-2 text-left text-xs font-medium text-info hover:underline" onClick={() => assign(viewer.id)} disabled={busy("assignee")}>
                  Assign to me
                </button>
              )}
            </Row>
            {item.status === "done" && item.resolution && (
              <Row label="Resolution">
                <span className="flex h-8 items-center px-2 font-medium text-success">{RESOLUTION_LABELS[item.resolution]}</span>
              </Row>
            )}
            <Row label="Reporter">
              <span className="flex h-8 items-center gap-2 px-2">
                {item.reporter ? (
                  <>
                    <UserAvatar name={item.reporter.name} size="sm" className="size-5" /> {item.reporter.name}
                  </>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </span>
            </Row>
            {item.type !== "epic" && (
              <Row label="Parent">
                <RefSelect
                  ghost
                  value={item.epic?.id ?? null}
                  options={item.epics.map((e) => ({ id: e.id, name: `${e.key} ${e.title}` }))}
                  noneLabel="None"
                  disabled={busy("parent")}
                  className={FIELD}
                  ariaLabel="Parent epic"
                  onChange={(v) => void save("parent", () => setItemParentAction({ itemId: item.id, parentId: v }))}
                />
              </Row>
            )}
            <Row label="Priority">
              <PrioritySelect ghost value={item.priority} disabled={busy("priority")} className={FIELD} onChange={(v) => void patch("priority", { priority: v })} />
            </Row>
            <Row label="Type">
              <TypeSelect ghost value={item.type} disabled={busy("type")} className={FIELD} onChange={(v) => void patch("type", { type: v })} />
            </Row>
            <Row label="Labels">
              <TextField value={item.labels.join(", ")} placeholder="None" disabled={busy("labels")} onSave={(v) => void patch("labels", { labels: parseLabels(v) })} />
            </Row>
            {mode === "sprints" && (
              <Row label="Sprint">
                <RefSelect
                  ghost
                  value={item.sprint?.id ?? null}
                  options={[
                    ...item.sprints.map((s) => ({ id: s.id, name: `${s.name}${s.status === "active" ? " (active)" : ""}` })),
                    ...(item.sprint && !item.sprints.some((s) => s.id === item.sprint!.id) ? [{ id: item.sprint.id, name: `${item.sprint.name} (${item.sprint.status})` }] : []),
                  ]}
                  noneLabel="None"
                  disabled={busy("sprint")}
                  className={FIELD}
                  ariaLabel="Sprint"
                  onChange={(v) => void save("sprint", () => setItemSprintAction({ itemId: item.id, sprintId: v }))}
                />
              </Row>
            )}
            <Row label="Story points">
              <NumberField value={item.estimatePoints} disabled={busy("points")} onSave={(v) => void patch("points", { estimatePoints: v })} />
            </Row>
            <Row label="Due date">
              <Input type="date" defaultValue={item.dueOn ?? ""} disabled={busy("due")} className={GHOST_INPUT} aria-label="Due date" onChange={(e) => void patch("due", { dueOn: e.target.value || null })} />
            </Row>
            <Row label="Source">
              <SourceSelect ghost value={item.source} disabled={busy("source")} className={FIELD} onChange={(v) => void patch("source", { source: v })} />
            </Row>
            {!canLinkClient && item.requester && (
              <Row label="Client" hint="Shown because you're on this client's workspace.">
                <Link href={WORK.client(item.requester.tenantId)} className="flex h-8 items-center px-2 font-medium text-info hover:underline">
                  {item.requester.tenantName}
                </Link>
              </Row>
            )}
            {canLinkClient && (
              <Row label="Client" hint="Developers see this only if they're on the client's workspace.">
                <RefSelect
                  ghost
                  value={item.requester?.tenantId ?? null}
                  options={tenants}
                  noneLabel="None"
                  disabled={busy("requester")}
                  className={FIELD}
                  ariaLabel="Requesting client"
                  onChange={(v) => void save("requester", () => setItemRequesterAction({ itemId: item.id, requesterTenantId: v }))}
                />
              </Row>
            )}
          </dl>
        )}
      </div>

      <dl className="flex flex-col gap-0.5 px-1 text-xs text-muted-foreground">
        <div title={formatDateTime(item.createdAt)}>
          Created {formatRelative(item.createdAt)}
          {createdBy && <> by <span className="font-medium text-foreground/80">{createdBy}</span></>}
        </div>
        <div title={formatDateTime(item.updatedAt)}>
          Updated {formatRelative(item.updatedAt)}
          {updatedBy && <> by <span className="font-medium text-foreground/80">{updatedBy}</span></>}
        </div>
        {item.startedAt && <div title={formatDateTime(item.startedAt)}>Started {formatRelative(item.startedAt)}</div>}
        {item.completedAt && (
          <div title={formatDateTime(item.completedAt)}>
            {item.status === "canceled" ? "Canceled" : "Resolved"} {formatRelative(item.completedAt)}
          </div>
        )}
      </dl>
    </aside>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-2">
      <dt className="flex h-8 items-center text-sm font-semibold text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col">
        {children}
        {hint && <p className="px-2 text-[11px] text-muted-foreground">{hint}</p>}
      </dd>
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
  return <Input type="number" min={0} max={100} value={v} disabled={disabled} className={GHOST_INPUT} aria-label="Story points" onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} placeholder="None" />;
}

function TextField({ value, placeholder, disabled, onSave }: { value: string; placeholder?: string; disabled: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const commit = () => {
    if (v.trim() === value.trim()) return;
    onSave(v);
  };
  return <Input value={v} disabled={disabled} className={GHOST_INPUT} aria-label="Labels" placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}
