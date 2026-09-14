"use client";

import { useState } from "react";
import type { ProductOps } from "../queries";
import { updateProductAction } from "../actions";
import { PRODUCT_ICONS } from "../icons";
import { useAction } from "@/lib/use-action";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function ProductDetailsForm({ product }: { product: ProductOps["product"] }) {
  const { run, pending } = useAction();
  const [form, setForm] = useState({
    slug: product.slug,
    name: product.name,
    category: product.category,
    tagline: product.tagline ?? "",
    description: product.description,
    features: product.features.join("\n"),
    color: product.color ?? "",
    icon: product.icon ?? "none",
    trialDays: product.trialDays ?? 0,
    reporterQuietAfterMinutes: product.reporterQuietAfterMinutes ?? "",
    sortOrder: product.sortOrder,
    isActive: product.isActive,
  });

  function save() {
    void run(
      () =>
        updateProductAction({
          id: product.id,
          slug: form.slug.trim(),
          name: form.name,
          category: form.category,
          tagline: form.tagline || undefined,
          description: form.description,
          features: form.features.split("\n").map((s) => s.trim()).filter(Boolean),
          color: form.color || undefined,
          icon: form.icon === "none" ? null : form.icon,
          trialDays: Number(form.trialDays) || null,
          reporterQuietAfterMinutes: form.reporterQuietAfterMinutes === "" ? null : Number(form.reporterQuietAfterMinutes),
          sortOrder: Number(form.sortOrder) || 0,
          isActive: form.isActive,
        }),
      { key: "product", success: "Product saved" },
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Section title="Catalog copy" description="What clients see on the marketing site and at checkout." card>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-category">Category</Label>
            <Input id="p-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="p-tagline">Tagline</Label>
          <Input id="p-tagline" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="p-desc">Description</Label>
          <Textarea id="p-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="p-features">Features (one per line)</Label>
          <Textarea id="p-features" rows={5} value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} />
        </div>
      </Section>

      <Section title="Identity & behaviour" card>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="p-slug">Slug</Label>
            <Input
              id="p-slug"
              value={form.slug}
              disabled={product.isMarketing}
              onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              {product.isMarketing ? "marketing-* slugs are the MHub contract — locked." : "Public URL and reporting key; must stay unique."}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-color">Brand color</Label>
            <Input id="p-color" value={form.color} placeholder="#7a6cf0" onChange={(e) => setForm({ ...form, color: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label>Icon</Label>
            <Select value={form.icon} onValueChange={(v) => setForm({ ...form, icon: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {PRODUCT_ICONS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="p-trial">Free trial (days, 0 = none)</Label>
            <Input id="p-trial" type="number" min={0} max={90} value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: Number(e.target.value) })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-quiet">Reporter quiet after (minutes)</Label>
            <Input id="p-quiet" type="number" min={5} max={20160} placeholder="1440" value={form.reporterQuietAfterMinutes} onChange={(e) => setForm({ ...form, reporterQuietAfterMinutes: e.target.value })} />
            <p className="text-xs text-muted-foreground">Blank = 24h. A subscription that posts no metrics for this long shows as a quiet reporter.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-order">Catalog order</Label>
            <Input id="p-order" type="number" min={0} max={999} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: Boolean(v) })} />
          Visible in the catalog and purchasable
        </label>
        <Button onClick={save} disabled={pending} className="w-fit">{pending ? "Saving…" : "Save product"}</Button>
      </Section>
    </div>
  );
}
