"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The one confirmation UX (replaces window.confirm everywhere):
 *
 *   const confirm = useConfirm();
 *   const ok = await confirm({ title: "Cancel subscription?", destructive: true });
 *   if (!ok) return;
 *
 * With `field`, the result carries the typed value: `{ value: "note…" }`.
 */
export type ConfirmOptions = {
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  field?: { label: string; placeholder?: string; required?: boolean; initial?: string };
};
export type ConfirmResult = false | { value?: string };

const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<ConfirmResult>) | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [value, setValue] = useState("");
  const resolver = useRef<((r: ConfirmResult) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    setValue(o.field?.initial ?? "");
    return new Promise<ConfirmResult>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = (r: ConfirmResult) => {
    resolver.current?.(r);
    resolver.current = null;
    setOpts(null);
  };

  const ctx = useMemo(() => confirm, [confirm]);
  const blocked = Boolean(opts?.field?.required && !value.trim());

  return (
    <ConfirmContext.Provider value={ctx}>
      {children}
      <AlertDialog open={!!opts} onOpenChange={(open) => !open && settle(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
            {opts?.description && <AlertDialogDescription>{opts.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          {opts?.field && (
            <div className="grid gap-2">
              <Label htmlFor="confirm-field">{opts.field.label}</Label>
              <Input
                id="confirm-field"
                autoFocus
                placeholder={opts.field.placeholder}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>{opts?.cancelLabel ?? "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              variant={opts?.destructive ? "destructive" : "default"}
              disabled={blocked}
              onClick={() => settle({ value: opts?.field ? value.trim() : undefined })}
            >
              {opts?.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}
