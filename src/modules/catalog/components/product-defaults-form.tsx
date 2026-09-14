"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { ProductOps } from "../queries";
import { updateProductDefaultsAction } from "../actions";
import { toCents } from "@/lib/money";
import { useAction } from "@/lib/use-action";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProductDefaultsForm({
  product,
  platform,
}: {
  product: ProductOps["product"];
  /** The env fallback, so the operator sees what applies when a field is blank. */
  platform: { expectedCname: string | null; expectedAIps: string | null };
}) {
  const { run, pending } = useAction();
  const [form, setForm] = useState({
    cname: product.defaultExpectedCname ?? "",
    ips: product.defaultExpectedAIps ?? "",
    hosting: product.defaultMonthlyHostingCents ? (product.defaultMonthlyHostingCents / 100).toFixed(2) : "",
  });

  function save() {
    let hosting: number | null = null;
    try {
      hosting = form.hosting.trim() ? toCents(form.hosting) : null;
    } catch {
      toast.error("Enter a valid hosting amount, or leave it blank");
      return;
    }
    void run(
      () =>
        updateProductDefaultsAction({
          id: product.id,
          defaultExpectedCname: form.cname || null,
          defaultExpectedAIps: form.ips || null,
          defaultMonthlyHostingCents: hosting,
        }),
      { key: "defaults", success: "Defaults saved — they apply to new subscriptions" },
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="DNS targets for new subscriptions"
        description="Seeded onto each new provisioning row (and filled in by Configure verification). Existing subscriptions keep what they have."
        card
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="d-cname">Expected CNAME</Label>
            <Input id="d-cname" value={form.cname} onChange={(e) => setForm({ ...form, cname: e.target.value })} placeholder={platform.expectedCname ?? "edge.railway.app"} />
            <p className="text-xs text-muted-foreground">
              Blank → platform default {platform.expectedCname ? <span className="font-mono">{platform.expectedCname}</span> : "(none set)"}.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="d-ips">A-record allow-list (comma-separated)</Label>
            <Input id="d-ips" value={form.ips} onChange={(e) => setForm({ ...form, ips: e.target.value })} placeholder={platform.expectedAIps ?? "1.2.3.4, 5.6.7.8"} />
            <p className="text-xs text-muted-foreground">
              Blank → platform default {platform.expectedAIps ? <span className="font-mono">{platform.expectedAIps}</span> : "(none set)"}.
            </p>
          </div>
        </div>
      </Section>

      <Section
        title="Suggested hosting fee"
        description="Prefills the hosting-fee dialog on a subscription of this product. Nothing is billed until an operator saves it there."
        card
      >
        <div className="grid gap-2 sm:max-w-xs">
          <Label htmlFor="d-hosting">Monthly fee (USD, blank = no suggestion)</Label>
          <Input id="d-hosting" value={form.hosting} onChange={(e) => setForm({ ...form, hosting: e.target.value })} placeholder="35.00" />
        </div>
        <Button onClick={save} disabled={pending} className="w-fit">{pending ? "Saving…" : "Save defaults"}</Button>
      </Section>
    </div>
  );
}
