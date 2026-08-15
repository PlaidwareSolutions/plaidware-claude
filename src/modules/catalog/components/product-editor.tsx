"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { updateProductAction, upsertComponentAction } from "../actions";
import { formatCents, toCents } from "@/lib/money";
import { intervalLabel } from "@/modules/billing/mappers";
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
  role: string;
  interval: string | null;
  intervalCount: number;
  name: string;
  description: string | null;
  amountCents: number;
  isRequired: boolean;
  isActive: boolean;
  synced: boolean;
};

function freqLabel(c: { kind: string; interval?: string | null; intervalCount?: number | null }) {
  if (c.kind === "one_time") return "one-time";
  const lbl = intervalLabel(c);
  return lbl ? `every${lbl.replace("/", " ")}`.replace("every mo", "monthly").replace("every yr", "yearly").replace("every wk", "weekly").replace("every quarter", "quarterly") : c.kind;
}

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
  const [compEvery, setCompEvery] = useState("1");

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
      kind: (editComp.kind === "one_time" ? "one_time" : "recurring") as "one_time" | "recurring",
      interval:
        editComp.kind === "one_time"
          ? undefined
          : ((editComp.interval ?? "month") as "week" | "month" | "year"),
      intervalCount: parseInt(compEvery, 10) || 1,
      role: (editComp.role === "base" ? "base" : "addon") as "base" | "addon",
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
              setEditComp({ kind: "recurring", interval: "month", intervalCount: 1, role: "addon", isRequired: false, isActive: true });
              setCompAmount("");
              setCompEvery("1");
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
                  {c.role === "base" && <Badge className="text-[10px]">main charge</Badge>}
                  {c.isRequired && c.role !== "base" && <Badge className="text-[10px]">required</Badge>}
                  {!c.isActive && <Badge variant="destructive" className="text-[10px]">hidden</Badge>}
                  {!c.synced && <Badge variant="outline" className="text-[10px]">syncs at next checkout</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {freqLabel(c)}{c.description ? ` · ${c.description}` : ""}
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
                    setCompEvery(String(c.intervalCount || 1));
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
                  value={editComp?.kind === "one_time" ? "one_time" : "recurring"}
                  onValueChange={(v) => setEditComp({ ...editComp, kind: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_time">One-time</SelectItem>
                    <SelectItem value="recurring">Recurring</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Amount (USD)</Label>
                <Input value={compAmount} placeholder="199.00" onChange={(e) => setCompAmount(e.target.value)} />
              </div>
            </div>
            {editComp?.kind !== "one_time" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Every</Label>
                  <Input value={compEvery} onChange={(e) => setCompEvery(e.target.value)} placeholder="1" />
                </div>
                <div className="grid gap-2">
                  <Label>Interval</Label>
                  <Select
                    value={editComp?.interval ?? "month"}
                    onValueChange={(v) => setEditComp({ ...editComp, interval: v })}
                  >
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
                <Checkbox checked={editComp?.role === "base"} onCheckedChange={(v) => setEditComp({ ...editComp, role: v ? "base" : "addon" })} />
                Main charge (one per product)
              </label>
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
