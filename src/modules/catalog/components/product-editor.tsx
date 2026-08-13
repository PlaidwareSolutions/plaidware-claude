"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { updateProductAction, upsertComponentAction } from "../actions";
import { formatCents, toCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
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
import { Textarea } from "@/components/ui/textarea";

type ProductForm = {
  id: string;
  slug: string;
  name: string;
  category: string;
  tagline: string | null;
  description: string;
  features: string[];
  color: string | null;
  trialDays: number | null;
  isActive: boolean;
};

type ComponentRow = {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  amountCents: number;
  isRequired: boolean;
  isActive: boolean;
  synced: boolean;
};

const KIND_LABEL: Record<string, string> = {
  one_time: "one-time",
  recurring_monthly: "monthly",
  recurring_yearly: "yearly",
  metered: "metered",
};

export function ProductEditor({
  product,
  components,
}: {
  product: ProductForm;
  components: ComponentRow[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(product);
  const [featuresText, setFeaturesText] = useState(product.features.join("\n"));
  const [busy, setBusy] = useState(false);
  const [editComp, setEditComp] = useState<Partial<ComponentRow> | null>(null);
  const [compAmount, setCompAmount] = useState("");

  async function saveProduct() {
    setBusy(true);
    const res = await updateProductAction({
      id: form.id,
      name: form.name,
      category: form.category,
      tagline: form.tagline ?? undefined,
      description: form.description,
      features: featuresText.split("\n").map((s) => s.trim()).filter(Boolean),
      color: form.color ?? undefined,
      trialDays: form.trialDays,
      isActive: form.isActive,
    });
    setBusy(false);
    if (res.ok) {
      toast.success("Product saved");
      router.refresh();
    } else toast.error(res.error);
  }

  async function saveComponent() {
    if (!editComp) return;
    let cents: number;
    try {
      cents = toCents(compAmount);
    } catch {
      toast.error("Enter a valid amount");
      return;
    }
    setBusy(true);
    const res = await upsertComponentAction({
      id: editComp.id,
      productId: form.id,
      kind: (editComp.kind ?? "recurring_monthly") as "one_time" | "recurring_monthly" | "recurring_yearly",
      name: editComp.name ?? "",
      description: editComp.description ?? undefined,
      amountCents: cents,
      isRequired: editComp.isRequired ?? false,
      isActive: editComp.isActive ?? true,
    });
    setBusy(false);
    if (res.ok) {
      toast.success("Component saved — price re-syncs to Stripe at next checkout");
      setEditComp(null);
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-heading">{product.name}</h1>
          <p className="text-sm text-muted-foreground">/{product.slug}</p>
        </div>
        <Badge variant={form.isActive ? "secondary" : "destructive"}>
          {form.isActive ? "active" : "hidden"}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Product</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Category</Label>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Tagline</Label>
            <Input value={form.tagline ?? ""} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label>Description</Label>
            <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label>Features (one per line)</Label>
            <Textarea rows={5} value={featuresText} onChange={(e) => setFeaturesText(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>Brand color</Label>
              <Input value={form.color ?? ""} placeholder="#7a6cf0" onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Free trial (days)</Label>
              <Input
                type="number"
                min={0}
                max={90}
                value={form.trialDays ?? 0}
                onChange={(e) => setForm({ ...form, trialDays: Number(e.target.value) || null })}
              />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <Checkbox checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: Boolean(v) })} />
              Visible in catalog
            </label>
          </div>
          <Button onClick={saveProduct} disabled={busy} className="w-fit">
            {busy ? "Saving…" : "Save product"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Pricing components</CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => {
              setEditComp({ kind: "recurring_monthly", isRequired: false, isActive: true });
              setCompAmount("");
            }}
          >
            <Plus className="size-4" /> Add
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {components.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-heading">
                  {c.name}
                  {c.isRequired && <Badge className="text-[10px]">required</Badge>}
                  {!c.isActive && <Badge variant="destructive" className="text-[10px]">hidden</Badge>}
                  {!c.synced && <Badge variant="outline" className="text-[10px]">syncs at next checkout</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {KIND_LABEL[c.kind]}{c.description ? ` · ${c.description}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums text-heading">
                  {formatCents(c.amountCents)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditComp(c);
                    setCompAmount((c.amountCents / 100).toFixed(2));
                  }}
                >
                  <Pencil className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!editComp} onOpenChange={(o) => !o && setEditComp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editComp?.id ? "Edit component" : "New component"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={editComp?.name ?? ""} onChange={(e) => setEditComp({ ...editComp, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Input value={editComp?.description ?? ""} onChange={(e) => setEditComp({ ...editComp, description: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Billing</Label>
                <Select
                  value={editComp?.kind ?? "recurring_monthly"}
                  onValueChange={(v) => setEditComp({ ...editComp, kind: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_time">One-time</SelectItem>
                    <SelectItem value="recurring_monthly">Monthly</SelectItem>
                    <SelectItem value="recurring_yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Amount (USD)</Label>
                <Input value={compAmount} placeholder="199.00" onChange={(e) => setCompAmount(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-6 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox checked={editComp?.isRequired ?? false} onCheckedChange={(v) => setEditComp({ ...editComp, isRequired: Boolean(v) })} />
                Required at checkout
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={editComp?.isActive ?? true} onCheckedChange={(v) => setEditComp({ ...editComp, isActive: Boolean(v) })} />
                Active
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={saveComponent} disabled={busy || !editComp?.name || !compAmount}>
              {busy ? "Saving…" : "Save component"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
