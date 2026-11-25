"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useAction } from "@/lib/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { quickCreateItemAction } from "../../actions";
import type { WorkItemStatus, WorkItemType } from "../../contracts";
import type { WorkExplorerProduct } from "../../dto";
import type { Lane } from "../../explorer-logic";
import { TypeSelect } from "../pickers";

/**
 * Jira's "+ Create" at the foot of a column: type a title, Enter, done. The
 * item lands in this column and inherits the swimlane (company, assignee,
 * priority, client). Enter keeps the box open for the next one; Esc closes.
 */
export function InlineCreate({
  status,
  lane,
  products,
  defaultProduct,
  canLinkClient,
}: {
  status: WorkItemStatus;
  lane: Lane["defaults"];
  products: WorkExplorerProduct[];
  defaultProduct: string | undefined;
  canLinkClient: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<WorkItemType>("task");
  const [product, setProduct] = useState(lane.productSlug ?? defaultProduct ?? products[0]?.slug ?? "");
  const { run, isPending } = useAction();
  const busy = isPending(`create:${status}`);

  if (status === "canceled") return null;
  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-full justify-start gap-1.5 rounded-[3px] font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" /> Create issue
      </Button>
    );
  }

  async function submit() {
    const t = title.trim();
    if (!t || !product) return;
    const res = await run(
      () =>
        quickCreateItemAction({
          productSlug: product,
          title: t,
          status: status as Exclude<WorkItemStatus, "canceled">,
          type,
          priority: lane.priority,
          assigneeUserId: lane.assigneeUserId,
          parentId: lane.parentId,
          requesterTenantId: canLinkClient ? lane.requesterTenantId : undefined,
        }),
      { key: `create:${status}`, refresh: false, success: (r) => `${r.key} created` },
    );
    if (res?.ok) setTitle("");
  }

  return (
    <div className="flex flex-col gap-2 rounded-md bg-card p-2 shadow-board-card ring-2 ring-info/60">
      <Input
        autoFocus
        value={title}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
        placeholder="What needs to be done?"
        className="h-8"
        aria-label="New item title"
      />
      <div className="flex items-center gap-1.5">
        <TypeSelect value={type} onChange={setType} className="h-7 w-28 text-xs" />
        {!lane.productSlug && products.length > 1 && (
          <Select value={product} onValueChange={setProduct}>
            <SelectTrigger size="sm" className="h-7 min-w-0 flex-1 text-xs" aria-label="Company">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {products.map((p) => (
                <SelectItem key={p.slug} value={p.slug}>
                  <span className="inline-flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: p.color ?? "var(--primary)" }} />
                    {p.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="xs" onClick={() => { setTitle(""); setOpen(false); }}>
          Cancel
        </Button>
        <Button size="xs" disabled={busy || !title.trim()} onClick={() => void submit()}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </div>
    </div>
  );
}
