"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Crown, Pencil, Plus } from "lucide-react";
import type { ComponentEditorDto } from "../queries";
import { reorderComponentsAction, setBaseComponentAction, upsertComponentAction } from "../actions";
import { cadenceLabel } from "../pricing";
import { formatCents, toCents } from "@/lib/money";
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
import { toast } from "sonner";

type Draft = Partial<ComponentEditorDto> & { amount: string; every: string };

const blank = (): Draft => ({
  kind: "recurring",
  interval: "month",
  intervalCount: 1,
  role: "addon",
  isRequired: false,
  isActive: true,
  name: "",
  description: "",
  amount: "",
  every: "1",
});

export function ProductPricingPanel({
  productId,
  components,
}: {
  productId: string;
  components: ComponentEditorDto[];
}) {
  const { run, pending, isPending } = useAction();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const base = components.find((c) => c.role === "base");

  async function save() {
    if (!draft) return;
    let cents: number;
    try {
      cents = toCents(draft.amount);
    } catch {
      toast.error("Enter a valid amount");
      return;
    }
    const res = await run(
      () =>
        upsertComponentAction({
          id: draft.id,
          productId,
          kind: draft.kind === "one_time" ? "one_time" : "recurring",
          interval: draft.kind === "one_time" ? undefined : ((draft.interval ?? "month") as "week" | "month" | "year"),
          intervalCount: parseInt(draft.every, 10) || 1,
          role: draft.role === "base" ? "base" : "addon",
          name: draft.name ?? "",
          description: draft.description || undefined,
          amountCents: cents,
          isRequired: draft.isRequired ?? false,
          isActive: draft.isActive ?? true,
        }),
      { key: "component", success: draft.id ? "Component saved — a changed price re-mints in Stripe at the next checkout" : "Component added" },
    );
    if (res?.ok) setDraft(null);
  }

  async function makeBase(c: ComponentEditorDto) {
    const ok = await confirm({
      title: `Make "${c.name}" the main charge?`,
      description: base
        ? `"${base.name}" becomes an add-on. The main charge is always included at checkout and can't be removed from a subscription.`
        : "The main charge is always included at checkout and can't be removed from a subscription.",
      confirmLabel: "Set as main charge",
    });
    if (ok) void run(() => setBaseComponentAction(productId, c.id), { key: `base:${c.id}`, success: `"${c.name}" is the main charge` });
  }

  function move(index: number, dir: -1 | 1) {
    const ids = components.map((c) => c.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    void run(() => reorderComponentsAction(productId, ids), { key: "reorder" });
  }

  return (
    <Section
      title="Pricing components"
      count={components.length}
      description={base ? `Main charge: ${base.name}` : "No main charge yet — checkout needs one"}
      actions={
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setDraft({ ...blank(), role: base ? "addon" : "base" })}>
          <Plus className="size-4" /> Add component
        </Button>
      }
    >
      {components.length === 0 ? (
        <EmptyState title="No components" description="Add the main charge first; add-ons and one-time fees come after." />
      ) : (
        <div className="flex flex-col gap-2">
          {components.map((c, i) => (
            <div key={c.id} className={`flex items-center gap-3 rounded-lg border bg-card px-4 py-3 ${c.isActive ? "" : "opacity-60"}`}>
              <div className="flex flex-col">
                <button type="button" className="text-muted-foreground hover:text-heading disabled:opacity-30" disabled={i === 0 || pending} onClick={() => move(i, -1)} aria-label="Move up">
                  <ArrowUp className="size-3.5" />
                </button>
                <button type="button" className="text-muted-foreground hover:text-heading disabled:opacity-30" disabled={i === components.length - 1 || pending} onClick={() => move(i, 1)} aria-label="Move down">
                  <ArrowDown className="size-3.5" />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-heading">
                  {c.name}
                  {c.role === "base" && <Badge className="gap-1 text-[10px]"><Crown className="size-3" /> main charge</Badge>}
                  {c.isRequired && c.role !== "base" && <Badge variant="secondary" className="text-[10px]">required</Badge>}
                  {!c.isActive && <Badge variant="warning" className="text-[10px]">hidden</Badge>}
                  {!c.synced && c.isActive && <Badge variant="outline" className="text-[10px]">Stripe price mints at next checkout</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {cadenceLabel(c)}{c.description ? ` · ${c.description}` : ""}
                </div>
              </div>
              <span className="text-sm font-semibold tabular-nums text-heading">{formatCents(c.amountCents)}</span>
              {c.role !== "base" && c.isActive && (
                <Button variant="ghost" size="sm" disabled={isPending(`base:${c.id}`)} onClick={() => void makeBase(c)} title="Make this the main charge">
                  <Crown className="size-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setDraft({
                    ...c,
                    description: c.description ?? "",
                    amount: (c.amountCents / 100).toFixed(2),
                    every: String(c.intervalCount || 1),
                  })
                }
              >
                <Pencil className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit component" : "New component"}</DialogTitle>
            <DialogDescription>
              Changing an existing price never touches live subscriptions — they keep their snapshot; the next checkout mints a fresh Stripe price.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Name</Label>
                <Input value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Description</Label>
                <Input value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Billing</Label>
                  <Select value={draft.kind === "one_time" ? "one_time" : "recurring"} onValueChange={(v) => setDraft({ ...draft, kind: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="one_time">One-time</SelectItem>
                      <SelectItem value="recurring">Recurring</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Amount (USD)</Label>
                  <Input value={draft.amount} placeholder="199.00" onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
                </div>
              </div>
              {draft.kind !== "one_time" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Every</Label>
                    <Input value={draft.every} onChange={(e) => setDraft({ ...draft, every: e.target.value })} placeholder="1" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Interval</Label>
                    <Select value={draft.interval ?? "month"} onValueChange={(v) => setDraft({ ...draft, interval: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="week">Week(s)</SelectItem>
                        <SelectItem value="month">Month(s) — 3 = quarterly</SelectItem>
                        <SelectItem value="year">Year(s)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-6 text-sm">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={draft.role === "base"}
                    disabled={Boolean(base && base.id !== draft.id)}
                    onCheckedChange={(v) => setDraft({ ...draft, role: v ? "base" : "addon", isRequired: v ? true : draft.isRequired })}
                  />
                  Main charge{base && base.id !== draft.id ? ` (currently "${base.name}")` : ""}
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked={draft.isRequired ?? false} disabled={draft.role === "base"} onCheckedChange={(v) => setDraft({ ...draft, isRequired: Boolean(v) })} />
                  Required at checkout
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked={draft.isActive ?? true} onCheckedChange={(v) => setDraft({ ...draft, isActive: Boolean(v) })} />
                  Active
                </label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={save} disabled={pending || !draft?.name || !draft?.amount}>
              {pending ? "Saving…" : "Save component"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
