"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createProductAction } from "../actions";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function NewProductDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", tagline: "", description: "" });

  async function create() {
    setBusy(true);
    const res = await createProductAction({
      name: form.name,
      category: form.category,
      tagline: form.tagline || undefined,
      description: form.description,
    });
    setBusy(false);
    if (res.ok) {
      toast.success("Product created — add pricing components, then make it visible");
      setOpen(false);
      router.push(`/ops/products/${res.id}`);
    } else toast.error(res.error);
  }

  return (
    <>
      <Button className="gap-2" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> New product
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New product</DialogTitle>
            <DialogDescription>
              Starts hidden from the catalog. You&apos;ll add pricing components
              on the next screen, then flip it visible.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Custom Application" />
              </div>
              <div className="grid gap-2">
                <Label>Category</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Custom Software" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Tagline</Label>
              <Input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={create} disabled={busy || !form.name || !form.category || form.description.length < 10}>
              {busy ? "Creating…" : "Create product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
