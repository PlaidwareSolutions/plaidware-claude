"use client";

import { useState } from "react";
import { useAction } from "@/lib/use-action";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateBoardSettingsAction } from "../actions";
import { BOARD_COLUMNS, SPRINT_LENGTHS, type BoardColumn, type SprintLength, type WorkBoardMode, type WorkItemStatus } from "../contracts";
import { STATUS_LABELS } from "../transitions";

const WIP_COLUMNS = BOARD_COLUMNS.filter((c) => c !== "done");

/** Ops-admin settings for one board: key prefix, mode, cadence, WIP limits. */
export function BoardSettingsForm({
  board,
}: {
  board: {
    id: string;
    keyPrefix: string;
    mode: WorkBoardMode;
    sprintLengthDays: number;
    wipLimits: Partial<Record<WorkItemStatus, number>>;
    hasActiveSprint: boolean;
  };
}) {
  const { run, isPending } = useAction();
  const [keyPrefix, setKeyPrefix] = useState(board.keyPrefix);
  const [mode, setMode] = useState<WorkBoardMode>(board.mode);
  const [length, setLength] = useState<SprintLength>((SPRINT_LENGTHS as readonly number[]).includes(board.sprintLengthDays) ? (board.sprintLengthDays as SprintLength) : 14);
  const [wip, setWip] = useState<Record<string, string>>(Object.fromEntries(WIP_COLUMNS.map((c) => [c, board.wipLimits[c] == null ? "" : String(board.wipLimits[c])])));
  const busy = isPending("settings");
  const switchingOff = board.mode === "sprints" && mode === "kanban" && board.hasActiveSprint;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const wipLimits: Partial<Record<BoardColumn, number>> = {};
    for (const c of WIP_COLUMNS) {
      const n = Number(wip[c]);
      if (wip[c].trim() !== "" && Number.isInteger(n) && n >= 1) wipLimits[c] = n;
    }
    await run(() => updateBoardSettingsAction({ boardId: board.id, keyPrefix, mode, sprintLengthDays: length, wipLimits }), {
      key: "settings",
      refresh: false,
      success: "Board settings saved",
    });
  }

  return (
    <form onSubmit={save} className="flex max-w-2xl flex-col gap-8">
      <Section title="Identity" card>
        <div className="grid gap-2">
          <Label htmlFor="bs-prefix">Key prefix</Label>
          <Input id="bs-prefix" value={keyPrefix} onChange={(e) => setKeyPrefix(e.target.value.toUpperCase())} className="w-40 font-mono uppercase" maxLength={6} pattern="[A-Za-z][A-Za-z0-9]{1,5}" required />
          <p className="text-xs text-muted-foreground">2–6 letters or digits. Existing items keep their numbers; links use the product slug, so a change never breaks one.</p>
        </div>
      </Section>

      <Section title="Way of working" card>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as WorkBoardMode)}>
              <SelectTrigger className="w-full" aria-label="Mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="kanban">Kanban — continuous flow</SelectItem>
                <SelectItem value="sprints">Sprints — planned iterations</SelectItem>
              </SelectContent>
            </Select>
            {switchingOff && <p className="text-xs text-warning">A sprint is active. Complete it first; the server refuses the switch until then.</p>}
          </div>
          <div className="grid gap-2">
            <Label>Sprint length</Label>
            <Select value={String(length)} onValueChange={(v) => setLength(Number(v) as SprintLength)} disabled={mode !== "sprints"}>
              <SelectTrigger className="w-full" aria-label="Sprint length"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SPRINT_LENGTHS.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n === 7 ? "Weekly (7 days)" : "Bi-weekly (14 days)"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Sets the default window for new sprints.</p>
          </div>
        </div>
      </Section>

      <Section title="Work-in-progress limits" description="advisory: the column turns amber when exceeded" card>
        <div className="grid gap-4 sm:grid-cols-3">
          {WIP_COLUMNS.map((c) => (
            <div key={c} className="grid gap-2">
              <Label htmlFor={`wip-${c}`}>{STATUS_LABELS[c]}</Label>
              <Input id={`wip-${c}`} type="number" min={1} max={99} value={wip[c]} placeholder="none" onChange={(e) => setWip({ ...wip, [c]: e.target.value })} />
            </div>
          ))}
        </div>
      </Section>

      <div>
        <Button type="submit" disabled={busy || switchingOff}>{busy ? "Saving…" : "Save settings"}</Button>
      </div>
    </form>
  );
}
