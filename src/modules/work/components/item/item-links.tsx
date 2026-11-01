"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addItemLinkAction, removeItemLinkAction, searchLinkTargetsAction } from "../../actions";
import type { WorkLinkType } from "../../contracts";
import type { WorkItemLinkDto, WorkLinkTargetDto } from "../../dto";
import { LINK_CHOICES, type LinkDirection } from "../../link-logic";
import { STATUS_LABELS } from "../../transitions";
import { TypeIcon } from "../item-bits";
import { RefSelect } from "../pickers";
import { usePeekHref } from "../peek-link";

const CHOICE_OPTIONS = LINK_CHOICES.map((c) => ({ id: `${c.type}:${c.direction}`, name: c.label }));

/** Jira's "Linked work items": links grouped by how this item reads them, plus the add form. */
export function ItemLinks({
  itemId,
  links,
  adding,
  onAddingChange,
}: {
  itemId: string;
  links: WorkItemLinkDto[];
  adding: boolean;
  onAddingChange: (v: boolean) => void;
}) {
  const peek = usePeekHref();
  const { run, isPending } = useAction();
  const groups = useMemo(() => {
    const m = new Map<string, WorkItemLinkDto[]>();
    for (const l of links) m.set(l.phrase, [...(m.get(l.phrase) ?? []), l]);
    return [...m.entries()];
  }, [links]);

  if (links.length === 0 && !adding) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-foreground">Linked work items</h2>
        <Button variant="ghost" size="icon" className="ml-auto size-8 cursor-pointer rounded-[3px]" aria-label="Link an item" title="Link an item" onClick={() => onAddingChange(true)}>
          <Plus className="size-4" />
        </Button>
      </div>
      {groups.map(([phrase, rows]) => (
        <div key={phrase} className="flex flex-col gap-1">
          <div className="text-xs font-semibold text-muted-foreground">{phrase}</div>
          <ul className="divide-y rounded-[3px] border">
            {rows.map((l) => (
              <li key={l.id} className="group/link flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50">
                <TypeIcon type={l.item.type} />
                <Link href={peek.open(l.item.slug, l.item.number)} scroll={false} className="shrink-0 text-xs font-semibold text-muted-foreground hover:text-info hover:underline">
                  {l.item.key}
                </Link>
                <Link
                  href={peek.open(l.item.slug, l.item.number)}
                  scroll={false}
                  className={cn("min-w-0 flex-1 truncate text-foreground hover:underline", l.item.status === "done" && "line-through decoration-muted-foreground/60")}
                >
                  {l.item.title}
                </Link>
                <StatusBadge kind="workItem" status={l.item.status} label={STATUS_LABELS[l.item.status]} lozenge className="shrink-0" />
                <button
                  type="button"
                  className="cursor-pointer rounded-[3px] p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/link:opacity-100"
                  aria-label={`Remove link to ${l.item.key}`}
                  title="Remove link"
                  disabled={isPending(`unlink:${l.id}`)}
                  onClick={() => void run(() => removeItemLinkAction(l.id), { key: `unlink:${l.id}`, refresh: false, success: "Link removed" })}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {adding && <LinkForm itemId={itemId} onDone={() => onAddingChange(false)} />}
    </section>
  );
}

function LinkForm({ itemId, onDone }: { itemId: string; onDone: () => void }) {
  const { run, isPending } = useAction();
  const [choice, setChoice] = useState(CHOICE_OPTIONS[2].id); // "relates to"
  const [q, setQ] = useState("");
  const [results, setResults] = useState<WorkLinkTargetDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<WorkLinkTargetDto | null>(null);

  // Debounced search: by key ("FIXO-12") or words in the title, across every board.
  useEffect(() => {
    const term = q.trim();
    if (!term || picked) return;
    let live = true;
    const t = setTimeout(async () => {
      setSearching(true);
      const res = await searchLinkTargetsAction({ q: term, excludeItemId: itemId });
      if (!live) return;
      setSearching(false);
      setResults(res.ok ? res.items : []);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, itemId, picked]);

  async function save() {
    if (!picked) return;
    const [type, direction] = choice.split(":") as [WorkLinkType, LinkDirection];
    const res = await run(() => addItemLinkAction({ itemId, otherItemId: picked.id, type, direction }), {
      key: "link",
      refresh: false,
      success: `Linked to ${picked.key}`,
    });
    if (res?.ok) onDone();
  }

  return (
    <div className="flex flex-col gap-2 rounded-[3px] border bg-muted/30 p-3">
      <div className="grid items-start gap-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
        <RefSelect value={choice} options={CHOICE_OPTIONS} noneLabel="relates to" onChange={(v) => v && setChoice(v)} ariaLabel="Link type" className="h-9 w-full" />
        <div className="relative">
          {picked ? (
            <div className="flex h-9 items-center gap-2 rounded-[3px] border bg-background px-2 text-sm">
              <TypeIcon type={picked.type} />
              <span className="font-semibold text-muted-foreground">{picked.key}</span>
              <span className="min-w-0 flex-1 truncate">{picked.title}</span>
              <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label="Choose another item" onClick={() => setPicked(null)}>
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && onDone()}
              placeholder="Search by key (FIXO-12) or title"
              className="h-9 rounded-[3px] border-2 focus-visible:border-info focus-visible:ring-0"
              aria-label="Item to link"
            />
          )}
          {!picked && q.trim() && (
            <ul className="absolute inset-x-0 top-10 z-20 max-h-64 overflow-y-auto rounded-[3px] border bg-popover py-1 shadow-md" role="listbox">
              {searching && results.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>}
              {!searching && results.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No matching items</li>}
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      setPicked(r);
                      setResults([]);
                    }}
                  >
                    <TypeIcon type={r.type} />
                    <span className="shrink-0 text-xs font-semibold text-muted-foreground">{r.key}</span>
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <StatusBadge kind="workItem" status={r.status} label={STATUS_LABELS[r.status]} lozenge className="shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" className="h-8 cursor-pointer rounded-[3px]" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-8 cursor-pointer rounded-[3px] bg-info text-white hover:bg-info/90 dark:text-background"
          disabled={!picked || isPending("link")}
          onClick={() => void save()}
        >
          Link
        </Button>
      </div>
    </div>
  );
}
