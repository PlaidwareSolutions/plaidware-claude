"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Link2, Plus, Trash2 } from "lucide-react";
import type { ComponentDto, ProductDto } from "@/modules/catalog/queries";
import { setContactStatusAction } from "@/modules/contact/actions";
import { createClientSetupAction, lookupClientEmailAction } from "../actions";
import { buildProductProposal, combineTotals, type InviteProductEntry } from "../proposal";
import { formatCents } from "@/lib/money";
import { formatMonth, isoDay, monthKey } from "@/lib/dates";
import { normalizePhone } from "@/lib/phone";
import { OPS } from "@/lib/routes";
import { isRecurringKind } from "@/modules/billing/mappers";
import { rowsToItems, seedTermRows, type TermComponent, type TermRow } from "@/modules/billing/start-form";
import { ProductTermsEditor } from "@/modules/billing/components/product-terms-editor";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const STEPS = ["Client", "Workspace", "Products & pricing", "Domains", "Review"] as const;
type Step = 0 | 1 | 2 | 3 | 4;

type Section = {
  productId: string;
  domainUrl: string;
  /** "YYYY-MM" or "" — bill calendar months from here (the catch-up rides the link's payment). */
  billFromMonth: string;
  /** componentId → negotiated terms (prefilled with list). */
  items: Record<string, TermRow>;
};

type Lookup =
  | { state: "idle" }
  | { state: "new" }
  | { state: "existing"; name: string; needsPassword: boolean; workspace: { id: string; name: string } | null };

export type OnboardInitial = { clientName?: string; clientEmail?: string; tenantName?: string; phone?: string };

const toTerm = (c: ComponentDto): TermComponent => ({
  id: c.id,
  name: c.name,
  kind: c.kind,
  role: c.role,
  interval: c.interval,
  intervalCount: c.intervalCount,
  isRequired: c.isRequired,
  isActive: true,
  listCents: c.amountCents,
  overrideCents: null,
});

/** The invite entry a section describes — the shape the server stores and the welcome page prices. Throws on a bad amount. */
function sectionEntry(product: ProductDto, s: Section): InviteProductEntry {
  const items = rowsToItems(product.components.map(toTerm), s.items);
  return {
    productId: product.id,
    items: items.map((i) => {
      const c = product.components.find((x) => x.id === i.componentId)!;
      const st = i.settlement;
      return {
        componentId: i.componentId,
        priceCents: i.amountCents === c.amountCents ? null : i.amountCents,
        ...(i.quantity > 1 ? { quantity: i.quantity } : {}),
        ...(st?.mode === "waive" ? { settlement: { mode: "waive" as const } } : {}),
        ...(st?.mode === "offline"
          ? {
              settlement: {
                mode: "offline" as const,
                invoiceId: null,
                payment: { method: st.payment.method, reference: st.payment.reference ?? null, receivedAt: st.payment.receivedAt ?? null },
              },
            }
          : {}),
      };
    }),
    domainUrl: s.domainUrl.trim() || null,
    billFromMonth: s.billFromMonth || null,
  };
}

export function OnboardClientPage({
  products,
  initial,
  leadId,
}: {
  products: ProductDto[];
  initial?: OnboardInitial;
  leadId?: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);
  const [client, setClient] = useState({
    name: initial?.clientName ?? "",
    email: initial?.clientEmail ?? "",
    phone: initial?.phone ?? "",
  });
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const [tenantName, setTenantName] = useState(initial?.tenantName ?? "");
  const [sections, setSections] = useState<Section[]>([{ productId: "", domainUrl: "", billFromMonth: "", items: {} }]);
  const [sendEmail, setSendEmail] = useState(true);
  const [result, setResult] = useState<{ link: string; tenantId: string; superseded: number } | null>(null);

  const productOf = (s: Section) => products.find((p) => p.id === s.productId) ?? null;
  const ready = sections.filter((s) => productOf(s));
  const chosenIds = sections.map((s) => s.productId).filter(Boolean);
  const attachTo = lookup.state === "existing" ? lookup.workspace : null;

  async function checkEmail() {
    const email = client.email.trim();
    if (!email.includes("@")) return;
    const res = await lookupClientEmailAction(email);
    if (!res.ok) return;
    if (!res.exists) setLookup({ state: "new" });
    else {
      setLookup({ state: "existing", name: res.name, needsPassword: res.needsPassword, workspace: res.workspace });
      if (!client.name) setClient((c) => ({ ...c, name: res.name }));
    }
  }

  function pickProduct(index: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    setSections((prev) =>
      prev.map((s, i) =>
        i === index ? { ...s, productId, items: p ? seedTermRows(p.components.map(toTerm), isoDay()) : {} } : s,
      ),
    );
  }
  const updateSection = (index: number, patch: Partial<Section>) =>
    setSections((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  // Review totals reuse the exact pricing the client will see on /welcome.
  const proposal = (() => {
    try {
      const prods = ready.map((s) => {
        const product = productOf(s)!;
        const chosen = product.components.filter((c) => s.items[c.id]?.included);
        return buildProductProposal(
          sectionEntry(product, s),
          product.name,
          chosen.map((c, i) => ({ ...c, sortOrder: i })),
          new Map(),
        );
      });
      return { products: prods, ...combineTotals(prods) };
    } catch {
      return null;
    }
  })();

  const stepValid: Record<Step, boolean> = {
    0: client.name.trim().length >= 2 && client.email.includes("@") && (!client.phone.trim() || !!normalizePhone(client.phone)),
    1: Boolean(attachTo) || tenantName.trim().length >= 2,
    2: ready.length > 0 && proposal !== null,
    3: true,
    4: true,
  };

  async function create() {
    setBusy(true);
    try {
      const res = await createClientSetupAction({
        clientName: client.name.trim(),
        clientEmail: client.email.trim(),
        phone: client.phone.trim() || undefined,
        tenantName: attachTo ? attachTo.name : tenantName.trim(),
        tenantId: attachTo?.id,
        products: ready.map((s) => {
          const product = productOf(s)!;
          const items = rowsToItems(product.components.map(toTerm), s.items);
          return {
            productId: product.id,
            items: items.map((i) => ({
              componentId: i.componentId,
              priceCents: i.amountCents,
              quantity: i.quantity,
              settlement: i.settlement,
            })),
            domainUrl: s.domainUrl.trim() || undefined,
            billFromMonth: s.billFromMonth || undefined,
          };
        }),
        sendEmailToClient: sendEmail,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setResult({ link: res.link, tenantId: res.tenantId, superseded: res.superseded });
      if (res.emailError) toast.warning(`${res.emailError} — send the link yourself.`);
      toast.success(
        res.superseded
          ? `Setup created — ${res.superseded} older pending link${res.superseded === 1 ? "" : "s"} for the same product revoked`
          : sendEmail
            ? "Setup created — link emailed to the client"
            : "Setup created",
      );
      if (leadId) void setContactStatusAction(leadId, "contacted");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check the price fields");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const domainsToVerify = ready.filter((s) => s.domainUrl.trim()).length;
    const paidOffline = proposal?.products.flatMap((p) => p.lines).filter((l) => l.settled).reduce((s, l) => s + l.amountCents, 0) ?? 0;
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <Card className="border-success/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Check className="size-5 text-success" /> Setup link ready
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              One click for {client.name.split(" ")[0]}: set a password, pay {formatCents(proposal?.dueTodayCents ?? 0)}, done.
              The link expires in 14 days and is single-use — if it gets lost, regenerate it from the client page; never re-enter the setup.
            </p>
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-md border bg-secondary/40 pl-2">
                <Link2 className="size-4 shrink-0 text-primary" />
                <Input readOnly value={result.link} onFocus={(e) => e.currentTarget.select()} className="h-9 flex-1 border-0 bg-transparent px-0 font-mono text-xs shadow-none focus-visible:border-0 focus-visible:ring-0" />
              </div>
              <Button size="sm" variant="outline" className="shrink-0 gap-1" onClick={() => { navigator.clipboard.writeText(result.link); toast.success("Link copied"); }}>
                <Copy className="size-3.5" /> Copy
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Next steps</CardTitle></CardHeader>
          <CardContent>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
              <li>
                {sendEmail ? "The client received the link by email." : "Send the client the link above."}{" "}
                Their payment activates {ready.length === 1 ? "the product" : `all ${ready.length} products`} and saves the card for renewals.
              </li>
              {paidOffline > 0 && (
                <li>
                  {formatCents(paidOffline)} paid offline is already recorded as a paid invoice on the client&apos;s Billing tab; the link charges only the rest.
                </li>
              )}
              {domainsToVerify > 0 && (
                <li>
                  Once live, the domain{domainsToVerify === 1 ? "" : "s"} get a verification token automatically — send the client the DNS records from the{" "}
                  <Link href={OPS.clientTab(result.tenantId, "provisioning")} className="text-primary hover:underline">Provisioning tab</Link> and press Verify.
                </li>
              )}
              {result.superseded > 0 && (
                <li>
                  {result.superseded === 1 ? "An older pending link" : `${result.superseded} older pending links`} for the same product{" "}
                  {result.superseded === 1 ? "was" : "were"} revoked — only this one works now.
                </li>
              )}
              <li>
                Custom prices are held on the link and applied at payment for this onboarding only — the client&apos;s later purchases use list price
                unless you set standing Custom pricing on their page. Nothing to clean up if they never pay.
              </li>
            </ol>
          </CardContent>
        </Card>
        <div className="flex gap-2">
          <Button asChild><Link href={OPS.client(result.tenantId)}>Open client</Link></Button>
          <Button asChild variant="outline"><Link href={OPS.clients}>Back to clients</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <ol className="flex flex-wrap gap-1 text-sm">
        {STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={label} className="flex items-center gap-1">
              <button
                type="button"
                disabled={i > step}
                onClick={() => setStep(i as Step)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors",
                  active && "border-foreground bg-foreground text-background",
                  done && "border-success/50 text-success",
                  !active && !done && "text-muted-foreground",
                )}
              >
                <span className="text-xs tabular-nums">{done ? <Check className="size-3" /> : i + 1}</span>
                {label}
              </button>
              {i < STEPS.length - 1 && <span className="px-1 text-muted-foreground">›</span>}
            </li>
          );
        })}
      </ol>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          {step === 0 && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="ob-email">Client email</Label>
                  <Input id="ob-email" type="email" autoFocus value={client.email} onChange={(e) => { setClient({ ...client, email: e.target.value }); setLookup({ state: "idle" }); }} onBlur={checkEmail} placeholder="owner@client.com" />
                  {lookup.state === "existing" && (
                    <p className="text-xs text-success">
                      Existing account: {lookup.name}.{" "}
                      {lookup.workspace ? `Will attach to their workspace "${lookup.workspace.name}".` : "They own no workspace yet — one is created."}
                      {lookup.needsPassword ? " They haven't set a password yet — the setup link will ask for one." : ""}
                    </p>
                  )}
                  {lookup.state === "new" && <p className="text-xs text-muted-foreground">New account — no confirmation email; they choose a password on the setup link.</p>}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ob-name">Client name</Label>
                  <Input id="ob-name" value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} placeholder="Shams Haidary" />
                </div>
              </div>
              <div className="grid gap-1.5 sm:max-w-xs">
                <Label htmlFor="ob-phone">Phone</Label>
                <Input id="ob-phone" value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} placeholder="+1 555 123 4567" />
                <p className="text-xs text-muted-foreground">Optional, but the People tab flags accounts without one.</p>
              </div>
            </>
          )}

          {step === 1 && (
            <div className="grid gap-1.5 sm:max-w-md">
              <Label htmlFor="ob-tenant">Workspace / business name</Label>
              {attachTo ? (
                <>
                  <Input id="ob-tenant" value={attachTo.name} disabled />
                  <p className="text-xs text-muted-foreground">
                    {client.name || "This client"} already owns this workspace; the products are added to it.
                  </p>
                </>
              ) : (
                <>
                  <Input id="ob-tenant" autoFocus value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Exact Point Repairs" />
                  <p className="text-xs text-muted-foreground">Shown to the client everywhere; the slug is derived from it.</p>
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <>
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
                            {products.filter((p) => p.id === section.productId || !chosenIds.includes(p.id)).map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {sections.length > 1 && (
                        <Button variant="ghost" size="icon" className="mt-5 shrink-0" aria-label="Remove product" onClick={() => setSections((prev) => prev.filter((_, x) => x !== i))}>
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                    {product && (
                      <div className="grid gap-2">
                        <Label>Items & prices — edit any price; it applies to this client&apos;s onboarding only</Label>
                        <ProductTermsEditor
                          mode="setup_link"
                          components={product.components.map(toTerm)}
                          rows={section.items}
                          onChange={(rows) => updateSection(i, { items: rows })}
                        />
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Label htmlFor={`bill-from-${i}`} className="text-xs">Bill from</Label>
                          <Input
                            id={`bill-from-${i}`}
                            type="month"
                            max={monthKey()}
                            className="h-8 w-40 text-xs"
                            value={section.billFromMonth}
                            onChange={(e) => updateSection(i, { billFromMonth: e.target.value })}
                          />
                          <span className="text-[11px] text-muted-foreground">
                            {section.billFromMonth
                              ? `The client pays ${formatMonth(section.billFromMonth)} through this month on the link; renewals then run on the 1st.`
                              : "Leave empty to start on the day they pay."}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {chosenIds.length < products.length && (
                <Button variant="outline" className="w-fit gap-2" onClick={() => setSections((prev) => [...prev, { productId: "", domainUrl: "", billFromMonth: "", items: {} }])}>
                  <Plus className="size-4" /> Add another product
                </Button>
              )}
              {proposal && ready.length > 0 && (
                <p className="text-right text-sm font-medium text-heading">Client pays today: {formatCents(proposal.dueTodayCents)}</p>
              )}
            </>
          )}

          {step === 3 && (
            <div className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                Optional now. A domain set here is attached after payment and gets its verification token automatically; you can also add it later from the Provisioning tab.
              </p>
              {ready.map((s) => {
                const idx = sections.indexOf(s);
                return (
                  <div key={s.productId} className="grid gap-1.5 sm:max-w-md">
                    <Label htmlFor={`dom-${s.productId}`}>{productOf(s)!.name} — live domain</Label>
                    <Input id={`dom-${s.productId}`} value={s.domainUrl} onChange={(e) => updateSection(idx, { domainUrl: e.target.value })} placeholder="https://exactpointrepairs.com" />
                  </div>
                );
              })}
            </div>
          )}

          {step === 4 && proposal && (
            <div className="grid gap-4 text-sm">
              <div className="grid gap-1 sm:grid-cols-2">
                <div><span className="text-muted-foreground">Client</span><div className="text-heading">{client.name} · {client.email}{client.phone ? ` · ${client.phone}` : ""}</div></div>
                <div><span className="text-muted-foreground">Workspace</span><div className="text-heading">{attachTo ? `${attachTo.name} (existing)` : tenantName}</div></div>
              </div>
              {proposal.products.map((p) => (
                <div key={p.productId} className="rounded-lg border p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-semibold text-heading">{p.productName}</span>
                    {p.domainUrl && <span className="text-xs text-muted-foreground">{p.domainUrl}</span>}
                  </div>
                  {p.lines.filter((l) => !l.catchUp).map((l) => (
                    <div key={l.name} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        {l.name}{l.quantity > 1 ? ` ×${l.quantity}` : ""}
                        {l.settled && <Badge variant="success" className="ml-1.5 text-[10px]">paid offline</Badge>}
                        {l.waived && <Badge variant="outline" className="ml-1.5 text-[10px]">waived</Badge>}
                      </span>
                      <span className="tabular-nums text-heading">{formatCents(l.amountCents)} <span className="text-xs text-muted-foreground">{l.oneTime ? "one-time" : l.cadence}</span></span>
                    </div>
                  ))}
                  {p.billFromMonth && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Billed from {formatMonth(p.billFromMonth)} — the link charges the {formatCents(p.catchUpCents)} catch-up; renewals run on the 1st.
                    </div>
                  )}
                </div>
              ))}
              <div className="flex justify-between border-t pt-2 text-base font-semibold text-heading">
                <span>Due today</span><span className="tabular-nums">{formatCents(proposal.dueTodayCents)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {proposal.monthlyCents > 0 && `Then ${formatCents(proposal.monthlyCents)}/mo`}
                {proposal.monthlyCents > 0 && proposal.yearlyCents > 0 && " + "}
                {proposal.yearlyCents > 0 && `${formatCents(proposal.yearlyCents)}/yr`}
                {proposal.products.length > 1 && ` · the card is entered once and charged ${proposal.products.length} times`}
                {ready.length > 0 && !ready.some((s) => (productOf(s)?.components ?? []).some((c) => s.items[c.id]?.included && isRecurringKind(c.kind))) &&
                  " · no recurring item saves a card — the client confirms each product individually"}
              </p>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={sendEmail} onCheckedChange={(v) => setSendEmail(Boolean(v))} />
                Email the link to {client.email || "the client"} now
              </label>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep((s) => (s - 1) as Step)}>Back</Button>
        {step < 4 ? (
          <Button disabled={!stepValid[step]} onClick={() => setStep((s) => (s + 1) as Step)}>Continue</Button>
        ) : (
          <Button disabled={busy || !stepValid[2]} onClick={create}>{busy ? "Creating…" : "Create setup link"}</Button>
        )}
      </div>
    </div>
  );
}
