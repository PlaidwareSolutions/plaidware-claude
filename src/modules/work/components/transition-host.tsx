"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, Flag } from "lucide-react";
import { toast } from "sonner";
import { useAction } from "@/lib/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { moveItemAction, setItemFlagAction } from "../actions";
import { WORK_RESOLUTIONS, type WorkItemStatus, type WorkItemType, type WorkResolution } from "../contracts";
import { isRichTextEmpty } from "../rich-text";
import { RESOLUTION_LABELS, STATUS_LABELS, blockedReason, canTransition, defaultResolution, transitionNeedsScreen } from "../transitions";
import { RichEditor } from "./editor/rich-editor";

/** What a transition needs to know about the item. */
export type TransitionSubject = { id: string; key: string; type: WorkItemType; status: WorkItemStatus; title: string };
export type TransitionDetails = { resolution?: WorkResolution; comment?: string };

type Ctx = {
  /**
   * The workflow gate for a move: "blocked" (toast says why), null when the
   * person cancels the transition screen, otherwise the details to send
   * (empty for moves that need no screen). The board calls this before its
   * optimistic move.
   */
  ask: (item: TransitionSubject, to: WorkItemStatus) => Promise<TransitionDetails | null | "blocked">;
  /** ask() + the move itself (issue view, list view, card menu). Resolves true when it moved. */
  move: (item: TransitionSubject, to: WorkItemStatus) => Promise<boolean>;
  /** Add a flag (asks for a reason) or remove it. */
  flag: (item: TransitionSubject, flagged: boolean) => Promise<void>;
};

const TransitionCtx = createContext<Ctx | null>(null);

export function useWorkTransitions(): Ctx {
  const ctx = useContext(TransitionCtx);
  if (!ctx) throw new Error("useWorkTransitions needs <WorkTransitionHost> (src/app/(app)/work/layout.tsx)");
  return ctx;
}

type DoneScreen = { item: TransitionSubject; resolve: (d: TransitionDetails | null) => void };
type FlagScreen = { item: TransitionSubject; resolve: (reason: string | null) => void };

/**
 * Jira's transition screens for the whole work area: moving to Done asks
 * for a resolution and an optional comment; adding a flag asks why.
 * Mounted once in the work layout.
 */
export function WorkTransitionHost({ children }: { children: React.ReactNode }) {
  const { run } = useAction();
  const [done, setDone] = useState<DoneScreen | null>(null);
  const [flagging, setFlagging] = useState<FlagScreen | null>(null);

  const ask = useCallback<Ctx["ask"]>((item, to) => {
    if (item.status === to) return Promise.resolve(null);
    if (!canTransition(item.status, to)) {
      toast.error(`${item.key}: ${blockedReason(item.status, to)}`);
      return Promise.resolve("blocked");
    }
    if (!transitionNeedsScreen(to)) return Promise.resolve({});
    return new Promise((resolve) => setDone({ item, resolve }));
  }, []);

  const move = useCallback<Ctx["move"]>(
    async (item, to) => {
      const details = await ask(item, to);
      if (!details || details === "blocked") return false;
      const res = await run(() => moveItemAction({ itemId: item.id, status: to, ...details }), {
        key: `move:${item.id}`,
        refresh: false,
        success: to === "done" ? `${item.key} resolved` : undefined,
      });
      return !!res?.ok;
    },
    [ask, run],
  );

  const flag = useCallback<Ctx["flag"]>(
    async (item, flagged) => {
      const reason = flagged ? await new Promise<string | null>((resolve) => setFlagging({ item, resolve })) : "";
      if (reason === null) return;
      await run(() => setItemFlagAction({ itemId: item.id, flagged, reason: reason || undefined }), {
        key: `flag:${item.id}`,
        refresh: false,
        success: flagged ? `${item.key} flagged` : `Flag removed from ${item.key}`,
      });
    },
    [run],
  );

  return (
    <TransitionCtx.Provider value={{ ask, move, flag }}>
      {children}
      {done && (
        <DoneDialog
          key={done.item.id}
          item={done.item}
          onClose={(d) => {
            done.resolve(d);
            setDone(null);
          }}
        />
      )}
      {flagging && (
        <FlagDialog
          key={flagging.item.id}
          item={flagging.item}
          onClose={(reason) => {
            flagging.resolve(reason);
            setFlagging(null);
          }}
        />
      )}
    </TransitionCtx.Provider>
  );
}

function DoneDialog({ item, onClose }: { item: TransitionSubject; onClose: (d: TransitionDetails | null) => void }) {
  const [resolution, setResolution] = useState<WorkResolution>(defaultResolution(item.type));
  const comment = useRef("");
  const finish = () => onClose({ resolution, comment: isRichTextEmpty(comment.current) ? undefined : comment.current });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose(null)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-success" /> Resolve {item.key}
          </DialogTitle>
          <DialogDescription>
            {STATUS_LABELS[item.status]} → {STATUS_LABELS.done}: <span className="font-medium text-foreground">{item.title}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label>
            Resolution <span className="text-destructive">*</span>
          </Label>
          <Select value={resolution} onValueChange={(v) => setResolution(v as WorkResolution)}>
            <SelectTrigger className="w-56" aria-label="Resolution">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORK_RESOLUTIONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {RESOLUTION_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {item.type === "bug" ? "How was this bug resolved? Pick “Cannot reproduce” or “Duplicate” when nothing changed." : "Pick “Won't do” if this is being closed without the work."}
          </p>
        </div>
        <div className="grid gap-2">
          <Label>Comment</Label>
          <RichEditor initialHtml="" ariaLabel="Resolution comment" placeholder="What changed, how it was verified, release notes…" minHeight="min-h-24" media="thumb" onChange={(html) => (comment.current = html)} />
        </div>
        <DialogFooter>
          <Button variant="ghost" className="rounded-[3px]" onClick={() => onClose(null)}>
            Cancel
          </Button>
          <Button className="rounded-[3px] bg-info text-white hover:bg-info/90 dark:text-background" onClick={finish}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FlagDialog({ item, onClose }: { item: TransitionSubject; onClose: (reason: string | null) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="size-5 fill-warning text-warning" /> Add flag to {item.key}
          </DialogTitle>
          <DialogDescription>Flag an item that is blocked or needs attention. The card turns amber until the flag is removed.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onClose(reason.trim());
          }}
        >
          <Label htmlFor="flag-reason">Reason (optional)</Label>
          <Input id="flag-reason" autoFocus value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Waiting on the client's POS credentials" />
          <DialogFooter className="mt-2">
            <Button type="button" variant="ghost" className="rounded-[3px]" onClick={() => onClose(null)}>
              Cancel
            </Button>
            <Button type="submit" className="rounded-[3px] bg-warning text-white hover:bg-warning/90 dark:text-background">
              Add flag
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
