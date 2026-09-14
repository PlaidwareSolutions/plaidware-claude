"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Settings2 } from "lucide-react";
import { updateBillingPolicyAction } from "../ar-actions";
import { useAction } from "@/lib/use-action";
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

export type BillingPolicyDto = {
  reminderDays: number[];
  graceDays: number;
  autoSuspend: boolean;
  upcomingReminderDays: number;
};

export function policySummary(p: BillingPolicyDto): string {
  const reminders = p.reminderDays.length ? `reminders at ${p.reminderDays.join(" / ")} days past due` : "no past-due reminders";
  const suspend = p.autoSuspend ? `suspend at ${p.graceDays} days` : "no automatic suspension";
  const pre = p.upcomingReminderDays > 0 ? `pre-due notice ${p.upcomingReminderDays} day${p.upcomingReminderDays === 1 ? "" : "s"} before` : "no pre-due notice";
  return `${pre} · ${reminders} · ${suspend}`;
}

/** Edits the one platform-wide dunning policy — every client is affected. */
export function BillingPolicyEditor({ policy }: { policy: BillingPolicyDto }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    reminderDays: policy.reminderDays.join(", "),
    graceDays: String(policy.graceDays),
    autoSuspend: policy.autoSuspend,
    upcomingReminderDays: String(policy.upcomingReminderDays),
  });

  async function save() {
    const reminderDays = form.reminderDays
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((x) => Number(x));
    if (reminderDays.some((d) => !Number.isInteger(d) || d < 0)) {
      toast.error("Reminder days must be whole numbers, e.g. 3, 7, 14");
      return;
    }
    const res = await run(
      () =>
        updateBillingPolicyAction({
          reminderDays,
          graceDays: Number(form.graceDays),
          autoSuspend: form.autoSuspend,
          upcomingReminderDays: Number(form.upcomingReminderDays),
        }),
      { key: "policy", success: "Dunning policy saved — applies from the next sweep" },
    );
    if (res?.ok) setOpen(false);
  }

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Settings2 className="size-4" /> Edit policy
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Dunning policy <Badge variant="warning">platform-wide</Badge>
            </DialogTitle>
            <DialogDescription>
              One policy for every client. The daily sweep sends reminders as each threshold passes, then suspends
              the client&apos;s subscriptions once the grace period is exhausted.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="pol-rem">Reminder days past due (comma separated)</Label>
              <Input id="pol-rem" value={form.reminderDays} onChange={(e) => setForm({ ...form, reminderDays: e.target.value })} placeholder="3, 7, 14" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="pol-grace">Suspend after (days past due)</Label>
                <Input id="pol-grace" type="number" min={1} max={90} value={form.graceDays} onChange={(e) => setForm({ ...form, graceDays: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pol-pre">Pre-due notice (days before)</Label>
                <Input id="pol-pre" type="number" min={0} max={30} value={form.upcomingReminderDays} onChange={(e) => setForm({ ...form, upcomingReminderDays: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.autoSuspend} onCheckedChange={(v) => setForm({ ...form, autoSuspend: Boolean(v) })} />
              Suspend automatically once the grace period passes
            </label>
          </div>
          <DialogFooter>
            <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save policy"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
