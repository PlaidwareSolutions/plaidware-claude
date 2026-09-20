"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarRange, Play, Plus, Trash2 } from "lucide-react";
import { WORK } from "@/lib/routes";
import { formatDate } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { Section } from "@/components/section";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { completeSprintAction, createSprintAction, deleteSprintAction, startSprintAction } from "../../actions";
import type { CarryOver } from "../../contracts";
import type { WorkSprintListRow } from "../../queries";
import { SprintProgress, sprintTiming } from "../sprint-progress";

/** Plan, start and complete sprints for one board. */
export function SprintsPanel({
  slug,
  boardId,
  cadenceDays,
  sprints,
  defaults,
}: {
  slug: string;
  boardId: string;
  cadenceDays: number;
  sprints: WorkSprintListRow[];
  defaults: { startsOn: string; endsOn: string };
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const { run, isPending } = useAction();
  const active = sprints.find((s) => s.status === "active") ?? null;
  const planned = sprints.filter((s) => s.status === "planned").sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1));
  const completed = sprints.filter((s) => s.status === "completed");
  const [completing, setCompleting] = useState(false);

  async function start(s: WorkSprintListRow) {
    const ok = await confirm({
      title: `Start ${s.name}?`,
      description: `${formatDate(s.startsOn)} – ${formatDate(s.endsOn)}. The board switches to this sprint and its ${s.total} item${s.total === 1 ? "" : "s"} are committed.`,
      confirmLabel: "Start sprint",
    });
    if (!ok) return;
    await run(() => startSprintAction(s.id), { key: `start:${s.id}`, refresh: false, success: `${s.name} started` });
  }

  async function remove(s: WorkSprintListRow) {
    const ok = await confirm({ title: `Delete ${s.name}?`, description: "Its items go back to the backlog.", destructive: true, confirmLabel: "Delete" });
    if (!ok) return;
    await run(() => deleteSprintAction(s.id), { key: `del:${s.id}`, refresh: false, success: `${s.name} deleted` });
  }

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Active sprint"
        icon={CalendarRange}
        actions={<NewSprintDialog boardId={boardId} cadenceDays={cadenceDays} defaults={defaults} nextNumber={sprints.length + 1} />}
      >
        {active ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-heading">{active.name}</span>
              <StatusBadge kind="sprint" status="active" />
              <span className={`text-sm ${active.isOverdue ? "text-warning" : "text-muted-foreground"}`}>
                {formatDate(active.startsOn)} – {formatDate(active.endsOn)} · {sprintTiming(active)}
              </span>
              <span className="ml-auto flex gap-2">
                <Button asChild size="sm" variant="outline"><Link href={WORK.sprint(slug, active.id)}>Report</Link></Button>
                <Button size="sm" onClick={() => setCompleting(true)}>Complete sprint…</Button>
              </span>
            </div>
            {active.goal && <p className="text-sm text-muted-foreground">{active.goal}</p>}
            <SprintProgress done={active.done} total={active.total} />
            <div className="text-xs text-muted-foreground">
              {active.done}/{active.total} items done · {active.committedPoints ?? 0} points committed
            </div>
            <CompleteSprintDialog
              open={completing}
              onOpenChange={setCompleting}
              sprint={active}
              planned={planned}
              cadenceDays={cadenceDays}
              onDone={(id) => router.push(WORK.sprint(slug, id))}
            />
          </div>
        ) : (
          <EmptyState
            icon={CalendarRange}
            title="No sprint running"
            description={planned.length ? "Start one of the planned sprints below." : `Plan a ${cadenceDays}-day sprint, fill it from the backlog, then start it.`}
          />
        )}
      </Section>

      <Section title="Planned" count={planned.length}>
        {planned.length === 0 ? (
          <EmptyState compact title="Nothing planned" description="New sprints start planned; fill them from the backlog." />
        ) : (
          <ol className="divide-y rounded-lg border bg-card">
            {planned.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <Link href={WORK.sprint(slug, s.id)} className="font-medium text-heading hover:text-primary">{s.name}</Link>
                <span className="text-muted-foreground">{formatDate(s.startsOn)} – {formatDate(s.endsOn)} · {sprintTiming(s)}</span>
                <span className="text-xs text-muted-foreground">{s.total} item{s.total === 1 ? "" : "s"}</span>
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="outline" disabled={!!active || isPending(`start:${s.id}`)} title={active ? "Complete the active sprint first" : undefined} onClick={() => start(s)}>
                    <Play className="size-3.5" /> Start
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Delete ${s.name}`} disabled={isPending(`del:${s.id}`)} onClick={() => remove(s)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Completed" count={completed.length}>
        {completed.length === 0 ? (
          <EmptyState compact title="No completed sprints yet" />
        ) : (
          <ol className="divide-y rounded-lg border bg-card">
            {completed.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <Link href={WORK.sprint(slug, s.id)} className="font-medium text-heading hover:text-primary">{s.name}</Link>
                <span className="text-muted-foreground">{formatDate(s.startsOn)} – {formatDate(s.endsOn)}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {s.completedCount ?? 0}/{s.committedCount ?? 0} items · {s.completedPoints ?? 0}/{s.committedPoints ?? 0} pts
                </span>
                <Link href={WORK.sprint(slug, s.id)} className="ml-auto text-xs text-muted-foreground hover:text-primary">Report →</Link>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function NewSprintDialog({ boardId, cadenceDays, defaults, nextNumber }: { boardId: string; cadenceDays: number; defaults: { startsOn: string; endsOn: string }; nextNumber: number }) {
  const { run, isPending } = useAction();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", goal: "", startsOn: defaults.startsOn, endsOn: defaults.endsOn });
  const busy = isPending("new-sprint");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await run(
      () => createSprintAction({ boardId, name: form.name.trim() || undefined, goal: form.goal.trim() || null, startsOn: form.startsOn, endsOn: form.endsOn }),
      { key: "new-sprint", refresh: false, success: "Sprint planned — fill it from the backlog" },
    );
    if (res?.ok) {
      setOpen(false);
      setForm({ name: "", goal: "", startsOn: defaults.startsOn, endsOn: defaults.endsOn });
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" className="gap-2" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> New sprint
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Plan a sprint</DialogTitle>
              <DialogDescription>Defaults to the next {cadenceDays}-day window after the latest sprint. It stays planned until you start it.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="sp-name">Name</Label>
              <Input id="sp-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={`Sprint ${nextNumber}`} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="sp-start">Starts</Label>
                <Input id="sp-start" type="date" required value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sp-end">Ends</Label>
                <Input id="sp-end" type="date" required min={form.startsOn} value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sp-goal">Goal</Label>
              <Textarea id="sp-goal" rows={2} value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="What this sprint should ship" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !form.startsOn || !form.endsOn || form.endsOn < form.startsOn}>{busy ? "Planning…" : "Plan sprint"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CompleteSprintDialog({
  open,
  onOpenChange,
  sprint,
  planned,
  cadenceDays,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sprint: WorkSprintListRow;
  planned: WorkSprintListRow[];
  cadenceDays: number;
  onDone: (sprintId: string) => void;
}) {
  const { run, isPending } = useAction();
  const [carry, setCarry] = useState<CarryOver>("next");
  const unfinished = sprint.total - sprint.done;
  const next = planned[0];
  const busy = isPending("complete");

  async function submit() {
    const res = await run(() => completeSprintAction({ sprintId: sprint.id, carryOver: carry }), {
      key: "complete",
      refresh: false,
      success: (r) => `${sprint.name} completed — ${r.completedPoints} points done${r.carried ? `, ${r.carried} carried` : ""}`,
    });
    if (res?.ok) {
      onOpenChange(false);
      onDone(sprint.id);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete {sprint.name}?</DialogTitle>
          <DialogDescription>
            {sprint.done} of {sprint.total} items are done. Done items stay on the sprint for its report.
          </DialogDescription>
        </DialogHeader>
        {unfinished > 0 && (
          <div className="grid gap-2">
            <Label>Unfinished items ({unfinished}) move to</Label>
            <Select value={carry} onValueChange={(v) => setCarry(v as CarryOver)}>
              <SelectTrigger className="w-full" aria-label="Carry over"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="next">{next ? `${next.name} (planned)` : `A new ${cadenceDays}-day sprint`}</SelectItem>
                <SelectItem value="backlog">Backlog (started work stays on the board, unscheduled)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Completing…" : "Complete sprint"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
