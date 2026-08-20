"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Link2, UserPlus } from "lucide-react";
import type { ProductDto } from "@/modules/catalog/queries";
import { createClientSetupAction } from "../actions";
import { formatCents, toCents } from "@/lib/money";
import { intervalLabel } from "@/modules/billing/mappers";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const cadence = (c: { kind: string; interval?: string | null; intervalCount?: number | null }) =>
  c.kind === "one_time" ? "one-time" : intervalLabel(c);

export function OnboardClientWizard({ products }: { products: ProductDto[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [form, setForm] = useState({
    clientName: "",
    clientEmail: "",
    tenantName: "",
    productId: "",
    domainUrl: "",
    sendEmailToClient: true,
  });
  // componentId → { included, price } (price as dollars string, prefilled with list)
  const [items, setItems] = useState<Record<string, { included: boolean; price: string }>>({});

  const product = products.find((p) => p.id === form.productId) ?? null;

  function pickProduct(productId: string) {
    const p = products.find((x) => x.id === productId);
    setForm((f) => ({ ...f, productId }));
    setItems(
      Object.fromEntries(
        (p?.components ?? []).map((c) => [
          c.id,
          {
            included: c.role === "base" || c.isRequired,
            price: (c.amountCents / 100).toFixed(2),
          },
        ]),
      ),
    );
  }

  async function create() {
    if (!product) return;
    setBusy(true);
    try {
      const chosen = product.components.filter((c) => items[c.id]?.included);
      const res = await createClientSetupAction({
        clientName: form.clientName,
        clientEmail: form.clientEmail,
        tenantName: form.tenantName || `${form.clientName}'s workspace`,
        productId: product.id,
        items: chosen.map((c) => {
          const cents = toCents(items[c.id].price);
          return { componentId: c.id, priceCents: cents === c.amountCents ? null : cents };
        }),
        domainUrl: form.domainUrl || undefined,
        sendEmailToClient: form.sendEmailToClient,
      });
      if (res.ok) {
        setResult(res.link);
        toast.success(
          form.sendEmailToClient ? "Setup created — link emailed to the client" : "Setup created",
        );
        router.refresh();
      } else toast.error(res.error);
    } catch {
      toast.error("Check the price fields");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setOpen(false);
    setResult(null);
    setForm({ clientName: "", clientEmail: "", tenantName: "", productId: "", domainUrl: "", sendEmailToClient: true });
    setItems({});
  }

  const totals = product
    ? product.components
        .filter((c) => items[c.id]?.included)
        .reduce(
          (acc, c) => {
            try {
              acc.today += toCents(items[c.id].price);
            } catch {
              /* incomplete input */
            }
            return acc;
          },
          { today: 0 },
        )
    : { today: 0 };

  return (
    <>
      <Button className="gap-2" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" /> Onboard client
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && reset()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {result ? (
            <>
              <DialogHeader>
                <DialogTitle>Setup link ready</DialogTitle>
                <DialogDescription>
                  One click for the client: set a password, pay, done. The link
                  expires in 14 days and dies after use.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 rounded-md border bg-secondary/40 p-2">
                <Link2 className="size-4 shrink-0 text-primary" />
                <code className="flex-1 truncate text-xs">{result}</code>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => {
                    navigator.clipboard.writeText(result);
                    toast.success("Link copied");
                  }}
                >
                  <Copy className="size-3.5" /> Copy
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={reset}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Onboard a client</DialogTitle>
                <DialogDescription>
                  Configure everything here; the client gets one link to set a
                  password and pay.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label>Client name</Label>
                    <Input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} placeholder="Shams Haidary" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Client email</Label>
                    <Input type="email" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label>Workspace / business name</Label>
                  <Input value={form.tenantName} onChange={(e) => setForm({ ...form, tenantName: e.target.value })} placeholder="Exact Point Repairs" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Product</Label>
                  <Select value={form.productId} onValueChange={pickProduct}>
                    <SelectTrigger><SelectValue placeholder="Choose a product" /></SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {product && (
                  <div className="grid gap-2">
                    <Label>Items & prices (edit any price for this client)</Label>
                    {product.components.map((c) => {
                      const st = items[c.id] ?? { included: false, price: "" };
                      const locked = c.role === "base";
                      return (
                        <div key={c.id} className="flex items-center gap-2 rounded-md border p-2">
                          <Checkbox
                            checked={st.included}
                            disabled={locked}
                            onCheckedChange={(v) =>
                              setItems({ ...items, [c.id]: { ...st, included: Boolean(v) } })
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-heading">
                              {c.name}
                              {locked && <span className="ml-1.5 text-[10px] uppercase text-coral">main</span>}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              list {formatCents(c.amountCents)} {cadence(c)}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground">$</span>
                            <Input
                              className="h-8 w-24 text-right text-sm"
                              value={st.price}
                              disabled={!st.included}
                              onChange={(e) => setItems({ ...items, [c.id]: { ...st, price: e.target.value } })}
                            />
                            <span className="w-14 text-[11px] text-muted-foreground">{cadence(c)}</span>
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-right text-sm font-medium text-heading">
                      Client pays today: {formatCents(totals.today)}
                    </p>
                  </div>
                )}

                <div className="grid gap-1.5">
                  <Label>Live domain (optional — attached after payment)</Label>
                  <Input value={form.domainUrl} onChange={(e) => setForm({ ...form, domainUrl: e.target.value })} placeholder="https://exactpointrepairs.com" />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.sendEmailToClient}
                    onCheckedChange={(v) => setForm({ ...form, sendEmailToClient: Boolean(v) })}
                  />
                  Email the link to the client now
                </label>
              </div>
              <DialogFooter>
                <Button onClick={create} disabled={busy || !form.clientName || !form.clientEmail || !product}>
                  {busy ? "Creating…" : "Create setup link"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
