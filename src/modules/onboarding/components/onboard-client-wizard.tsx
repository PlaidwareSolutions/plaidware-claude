"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Link2, Plus, Trash2, UserPlus } from "lucide-react";
import type { ProductDto } from "@/modules/catalog/queries";
import { createClientSetupAction } from "../actions";
import { formatCents, toCents } from "@/lib/money";
import { intervalLabel, isRecurringKind } from "@/modules/billing/mappers";
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

type Section = {
  productId: string;
  domainUrl: string;
  // componentId → { included, price } (price as dollars string, prefilled with list)
  items: Record<string, { included: boolean; price: string }>;
};

const emptySection = (): Section => ({ productId: "", domainUrl: "", items: {} });

export function OnboardClientWizard({ products }: { products: ProductDto[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [form, setForm] = useState({
    clientName: "",
    clientEmail: "",
    tenantName: "",
    sendEmailToClient: true,
  });
  const [sections, setSections] = useState<Section[]>([emptySection()]);

  const productOf = (s: Section) => products.find((p) => p.id === s.productId) ?? null;
  const chosenIds = sections.map((s) => s.productId).filter(Boolean);

  function pickProduct(index: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    setSections((prev) =>
      prev.map((s, i) =>
        i === index
          ? {
              ...s,
              productId,
              items: Object.fromEntries(
                (p?.components ?? []).map((c) => [
                  c.id,
                  {
                    included: c.role === "base" || c.isRequired,
                    price: (c.amountCents / 100).toFixed(2),
                  },
                ]),
              ),
            }
          : s,
      ),
    );
  }

  function updateSection(index: number, patch: Partial<Section>) {
    setSections((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  async function create() {
    const ready = sections.filter((s) => productOf(s));
    if (ready.length === 0) return;
    setBusy(true);
    try {
      const res = await createClientSetupAction({
        clientName: form.clientName,
        clientEmail: form.clientEmail,
        tenantName: form.tenantName || `${form.clientName}'s workspace`,
        products: ready.map((s) => {
          const product = productOf(s)!;
          const chosen = product.components.filter((c) => s.items[c.id]?.included);
          return {
            productId: product.id,
            items: chosen.map((c) => {
              const cents = toCents(s.items[c.id].price);
              return { componentId: c.id, priceCents: cents === c.amountCents ? null : cents };
            }),
            domainUrl: s.domainUrl || undefined,
          };
        }),
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
    setForm({ clientName: "", clientEmail: "", tenantName: "", sendEmailToClient: true });
    setSections([emptySection()]);
  }

  const totalToday = sections.reduce((sum, s) => {
    const product = productOf(s);
    if (!product) return sum;
    return (
      sum +
      product.components
        .filter((c) => s.items[c.id]?.included)
        .reduce((acc, c) => {
          try {
            return acc + toCents(s.items[c.id].price);
          } catch {
            return acc; // incomplete input
          }
        }, 0)
    );
  }, 0);
  const anyRecurring = sections.some((s) =>
    (productOf(s)?.components ?? []).some((c) => s.items[c.id]?.included && isRecurringKind(c.kind)),
  );
  const readyCount = sections.filter((s) => productOf(s)).length;

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
                  Configure everything here — one or more products; the client
                  gets one link to set a password and pay once.
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

                {sections.map((section, i) => {
                  const product = productOf(section);
                  return (
                    <div key={i} className="grid gap-3 rounded-lg border p-3">
                      <div className="flex items-center gap-2">
                        <div className="grid flex-1 gap-1.5">
                          <Label>{sections.length > 1 ? `Product ${i + 1}` : "Product"}</Label>
                          <Select value={section.productId} onValueChange={(v) => pickProduct(i, v)}>
                            <SelectTrigger><SelectValue placeholder="Choose a product" /></SelectTrigger>
                            <SelectContent>
                              {products
                                .filter((p) => p.id === section.productId || !chosenIds.includes(p.id))
                                .map((p) => (
                                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {sections.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="mt-5 shrink-0"
                            aria-label="Remove product"
                            onClick={() => setSections((prev) => prev.filter((_, x) => x !== i))}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>

                      {product && (
                        <div className="grid gap-2">
                          <Label>Items & prices (edit any price for this client)</Label>
                          {product.components.map((c) => {
                            const st = section.items[c.id] ?? { included: false, price: "" };
                            const locked = c.role === "base";
                            return (
                              <div key={c.id} className="flex items-center gap-2 rounded-md border p-2">
                                <Checkbox
                                  checked={st.included}
                                  disabled={locked}
                                  onCheckedChange={(v) =>
                                    updateSection(i, {
                                      items: { ...section.items, [c.id]: { ...st, included: Boolean(v) } },
                                    })
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
                                    onChange={(e) =>
                                      updateSection(i, {
                                        items: { ...section.items, [c.id]: { ...st, price: e.target.value } },
                                      })
                                    }
                                  />
                                  <span className="w-14 text-[11px] text-muted-foreground">{cadence(c)}</span>
                                </div>
                              </div>
                            );
                          })}
                          <div className="grid gap-1.5">
                            <Label>Live domain (optional — attached after payment)</Label>
                            <Input
                              value={section.domainUrl}
                              onChange={(e) => updateSection(i, { domainUrl: e.target.value })}
                              placeholder="https://exactpointrepairs.com"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {chosenIds.length < products.length && (
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => setSections((prev) => [...prev, emptySection()])}
                  >
                    <Plus className="size-4" /> Add another product
                  </Button>
                )}

                <p className="text-right text-sm font-medium text-heading">
                  Client pays today: {formatCents(totalToday)}
                </p>
                {readyCount > 1 && (
                  <p className="text-right text-xs text-muted-foreground">
                    The client enters their card once; each product is charged
                    separately to the same card ({readyCount} charges).
                  </p>
                )}
                {readyCount > 0 && !anyRecurring && (
                  <p className="text-right text-xs text-warning">
                    No recurring item saves a card — the client will confirm each
                    product&apos;s payment individually.
                  </p>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.sendEmailToClient}
                    onCheckedChange={(v) => setForm({ ...form, sendEmailToClient: Boolean(v) })}
                  />
                  Email the link to the client now
                </label>
              </div>
              <DialogFooter>
                <Button onClick={create} disabled={busy || !form.clientName || !form.clientEmail || readyCount === 0}>
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
