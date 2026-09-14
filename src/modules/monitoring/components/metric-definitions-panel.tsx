"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Gauge, Pencil, Plus, Star, Trash2 } from "lucide-react";
import type { MetricDefinitionDto } from "@/modules/catalog/queries";
import {
  applyMetricTemplateAction,
  deleteMetricDefinitionAction,
  reorderMetricDefinitionsAction,
  upsertMetricDefinitionAction,
} from "../actions";
import { AGGREGATIONS, DIRECTIONS, VALUE_TYPES } from "../contracts";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { Section } from "@/components/section";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Draft = {
  id?: string;
  key: string;
  label: string;
  unit: string;
  valueType: string;
  aggregation: string;
  direction: string;
  target: string;
  isPrimary: boolean;
};

const blank = (): Draft => ({
  key: "",
  label: "",
  unit: "",
  valueType: "count",
  aggregation: "sum",
  direction: "up_is_good",
  target: "",
  isPrimary: false,
});

/**
 * The per-product KPI contract: what a reporter may post, how it aggregates,
 * and which tile leads. Was seed-only until now.
 */
export function MetricDefinitionsPanel({
  productId,
  productSlug,
  definitions,
  templates,
  reporterQuietAfterMinutes,
}: {
  productId: string;
  productSlug: string;
  definitions: MetricDefinitionDto[];
  /** Template slugs available in "start from template". */
  templates: string[];
  reporterQuietAfterMinutes: number | null;
}) {
  const { run, pending, isPending } = useAction();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [template, setTemplate] = useState(templates.includes(productSlug) ? productSlug : templates[0] ?? "");

  async function save() {
    if (!draft) return;
    const res = await run(
      () =>
        upsertMetricDefinitionAction({
          id: draft.id,
          productId,
          key: draft.key,
          label: draft.label,
          unit: draft.unit || null,
          valueType: draft.valueType as (typeof VALUE_TYPES)[number],
          aggregation: draft.aggregation as (typeof AGGREGATIONS)[number],
          direction: draft.direction as (typeof DIRECTIONS)[number],
          target: draft.target.trim() ? Number(draft.target) : null,
          isPrimary: draft.isPrimary,
        }),
      { key: "kpi", success: draft.id ? "KPI saved" : "KPI added — reporters can post it now" },
    );
    if (res?.ok) setDraft(null);
  }

  async function remove(d: MetricDefinitionDto) {
    const ok = await confirm({
      title: `Remove the "${d.label}" KPI?`,
      description: "Reporters posting this key get an unknown-key warning and the tile disappears from every client's Monitoring page. Recorded data is kept.",
      confirmLabel: "Remove KPI",
      destructive: true,
    });
    if (ok) void run(() => deleteMetricDefinitionAction(productId, d.id), { key: `del:${d.id}`, success: "KPI removed" });
  }

  function move(index: number, dir: -1 | 1) {
    const ids = definitions.map((d) => d.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    void run(() => reorderMetricDefinitionsAction(productId, ids), { key: "reorder" });
  }

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Monitoring KPIs"
        icon={Gauge}
        count={definitions.length}
        description={`Quiet after ${reporterQuietAfterMinutes ?? 1440} min without a report (edit on Details).`}
        actions={
          <>
            {templates.length > 0 && (
              <div className="flex items-center gap-1">
                <Select value={template} onValueChange={setTemplate}>
                  <SelectTrigger size="sm" className="w-44"><SelectValue placeholder="Template" /></SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => <SelectItem key={t} value={t}>{t} template</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!template || isPending("template")}
                  onClick={() =>
                    void run(() => applyMetricTemplateAction(productId, template), {
                      key: "template",
                      success: (r) => (r.added ? `${r.added} KPI${r.added === 1 ? "" : "s"} added from the template` : "Every template KPI already exists"),
                    })
                  }
                >
                  Start from template
                </Button>
              </div>
            )}
            <Button size="sm" className="gap-1" onClick={() => setDraft(blank())}>
              <Plus className="size-4" /> Add KPI
            </Button>
          </>
        }
      >
        {definitions.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title="No KPIs defined"
            description="Clients of this product see only uptime until a KPI exists. Add one or start from a template."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {definitions.map((d, i) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
                <div className="flex flex-col">
                  <button type="button" className="text-muted-foreground hover:text-heading disabled:opacity-30" disabled={i === 0 || pending} onClick={() => move(i, -1)} aria-label="Move up">
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button type="button" className="text-muted-foreground hover:text-heading disabled:opacity-30" disabled={i === definitions.length - 1 || pending} onClick={() => move(i, 1)} aria-label="Move down">
                    <ArrowDown className="size-3.5" />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-heading">
                    {d.label}
                    <span className="font-mono text-xs text-muted-foreground">{d.key}</span>
                    {d.isPrimary && <Badge className="gap-1 text-[10px]"><Star className="size-3" /> primary</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {d.aggregation} · {d.valueType}{d.unit ? ` · ${d.unit}` : ""} · {d.direction.replace(/_/g, " ")}
                    {d.target != null ? ` · target ${d.target}` : ""}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setDraft({
                      id: d.id,
                      key: d.key,
                      label: d.label,
                      unit: d.unit ?? "",
                      valueType: d.valueType,
                      aggregation: d.aggregation,
                      direction: d.direction,
                      target: d.target != null ? String(d.target) : "",
                      isPrimary: d.isPrimary,
                    })
                  }
                >
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" disabled={isPending(`del:${d.id}`)} onClick={() => void remove(d)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit KPI" : "New KPI"}</DialogTitle>
            <DialogDescription>
              Reporters post <span className="font-mono">{"{metric: <key>, quantity: <number>}"}</span>; <span className="font-mono">status</span> and{" "}
              <span className="font-mono">response_time_ms</span> are reserved for health.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Key</Label>
                  <Input value={draft.key} disabled={Boolean(draft.id)} placeholder="page_views" className="font-mono" onChange={(e) => setDraft({ ...draft, key: e.target.value.toLowerCase() })} />
                </div>
                <div className="grid gap-2">
                  <Label>Label</Label>
                  <Input value={draft.label} placeholder="Page views" onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label>Aggregation</Label>
                  <Select value={draft.aggregation} onValueChange={(v) => setDraft({ ...draft, aggregation: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{AGGREGATIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Value type</Label>
                  <Select value={draft.valueType} onValueChange={(v) => setDraft({ ...draft, valueType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{VALUE_TYPES.map((a) => <SelectItem key={a} value={a}>{a.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Direction</Label>
                  <Select value={draft.direction} onValueChange={(v) => setDraft({ ...draft, direction: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DIRECTIONS.map((a) => <SelectItem key={a} value={a}>{a.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Unit (optional)</Label>
                  <Input value={draft.unit} placeholder="views" onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Target (optional)</Label>
                  <Input value={draft.target} type="number" placeholder="1000" onChange={(e) => setDraft({ ...draft, target: e.target.value })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={draft.isPrimary} onCheckedChange={(v) => setDraft({ ...draft, isPrimary: Boolean(v) })} />
                Primary KPI (leads the client&apos;s Monitoring page; one per product)
              </label>
            </div>
          )}
          <DialogFooter>
            <Button onClick={save} disabled={pending || !draft?.key || !draft?.label}>{pending ? "Saving…" : "Save KPI"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
