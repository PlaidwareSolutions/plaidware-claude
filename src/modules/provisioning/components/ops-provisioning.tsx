"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Copy, Eye, Globe, KeyRound, Plus, RotateCcw, ShieldCheck, Trash2, Webhook } from "lucide-react";
import type { ProvisioningView } from "../queries";
import type { TenantDeliveryHealth } from "@/modules/webhooks_out/queries";
import { requeueDeliveryAction } from "@/modules/webhooks_out/actions";
import {
  configureVerificationAction,
  deleteCredentialAction,
  revealCredentialAction,
  runDnsVerifyAction,
  setDomainAction,
  setVerifyConfigAction,
  upsertCredentialAction,
} from "../actions";
import { buildDnsRecords } from "../dns-state";
import { hostFromUrl } from "../dns-verifier";
import { formatDate, formatDateTime } from "@/lib/dates";
import { OPS } from "@/lib/routes";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useOpsAccess } from "@/components/ops-access";

export type { ProvisioningView };

type Cred = ProvisioningView["credentials"][number];

const STATE_HINT: Record<ProvisioningView["state"], string> = {
  no_domain: "Set the live domain to start.",
  unconfigured: "Legacy row: nothing to verify against yet. Configure verification mints the TXT token and fills the routing targets.",
  configured: "Records are ready to send to the client — run Verify DNS once they've added them.",
  verified: "DNS proves ownership and routes to us.",
  failing: "The last check failed — see the detail below and re-run after the client updates DNS.",
  handshake_pending: "MHub hasn't returned a portal URL yet; the handshake retries automatically.",
  provisioned: "MHub owns this domain — nothing to verify here.",
};

export function OpsProvisioning({
  tenantId,
  items,
  deliveries,
}: {
  tenantId: string;
  items: ProvisioningView[];
  deliveries: TenantDeliveryHealth | null;
}) {
  const { run, isPending } = useAction();
  const confirm = useConfirm();
  const { canMutate } = useOpsAccess();
  const [credFor, setCredFor] = useState<{ subscriptionId: string; cred?: Cred } | null>(null);
  const [credForm, setCredForm] = useState({ kind: "hosting", label: "", url: "", username: "", secret: "" });
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  async function saveCred() {
    if (!credFor) return;
    const res = await run(
      () =>
        upsertCredentialAction({
          id: credFor.cred?.id,
          subscriptionId: credFor.subscriptionId,
          kind: credForm.kind as "registrar" | "dns" | "email" | "hosting" | "other",
          label: credForm.label,
          url: credForm.url || undefined,
          username: credForm.username || undefined,
          secret: credForm.secret || undefined,
        }),
      { key: "cred", success: "Credential saved (encrypted at rest)" },
    );
    if (res?.ok) setCredFor(null);
  }

  async function reveal(credId: string) {
    const res = await revealCredentialAction(credId);
    if (res.ok) {
      setRevealed((r) => ({ ...r, [credId]: res.secret }));
      toast.info("Reveal logged to the audit trail — hides in 30s");
      setTimeout(
        () =>
          setRevealed((r) => {
            const { [credId]: _drop, ...rest } = r;
            return rest;
          }),
        30_000,
      );
    } else toast.error(res.error);
  }

  const partnerItems = items.filter((i) => i.managedByPartner);

  return (
    <div className="flex flex-col gap-8">
      <Section title="Domains & DNS" icon={Globe} count={items.length}>
        {items.length === 0 ? (
          <EmptyState icon={Globe} title="Nothing to provision yet" description="Domains, DNS verification, and stored credentials appear here per live subscription." />
        ) : (
          <div className="flex flex-col gap-4">
            {items.map((item) => (
              <ProvisioningCard
                key={item.subscriptionId}
                tenantId={tenantId}
                readOnly={!canMutate}
                item={item}
                revealed={revealed}
                pending={(k) => isPending(`${k}:${item.subscriptionId}`)}
                onSaveDomain={(value) =>
                  void run(() => setDomainAction({ tenantId, subscriptionId: item.subscriptionId, domainUrl: value || null }), {
                    key: `domain:${item.subscriptionId}`,
                    success: value ? "Domain saved — verification records are ready below" : "Domain cleared",
                  })
                }
                onConfigure={() =>
                  void run(() => configureVerificationAction(item.subscriptionId), {
                    key: `configure:${item.subscriptionId}`,
                    success: "Verification configured — send the client the records below",
                  })
                }
                onVerify={async () => {
                  const res = await run(() => runDnsVerifyAction(item.subscriptionId), {
                    key: `verify:${item.subscriptionId}`,
                    success: (r) => (r.passed ? `DNS verified (${r.mode})` : `Not verified yet — ${r.detail}`),
                  });
                  void res;
                }}
                onSaveConfig={(form) =>
                  void run(
                    () =>
                      setVerifyConfigAction({
                        subscriptionId: item.subscriptionId,
                        verifyToken: form.token || null,
                        expectedCname: form.cname || null,
                        expectedAIps: form.ips || null,
                      }),
                    { key: `config:${item.subscriptionId}`, success: "Verification config saved" },
                  )
                }
                onAddCred={() => {
                  setCredFor({ subscriptionId: item.subscriptionId });
                  setCredForm({ kind: "hosting", label: "", url: "", username: "", secret: "" });
                }}
                onEditCred={(cred) => {
                  setCredFor({ subscriptionId: item.subscriptionId, cred });
                  setCredForm({ kind: cred.kind, label: cred.label, url: cred.url ?? "", username: cred.username ?? "", secret: "" });
                }}
                onDeleteCred={async (cred) => {
                  const ok = await confirm({
                    title: `Delete credential "${cred.label}"?`,
                    description: "The stored secret is erased. This cannot be undone.",
                    confirmLabel: "Delete",
                    destructive: true,
                  });
                  if (!ok) return;
                  void run(() => deleteCredentialAction(cred.id), { key: `delcred:${cred.id}`, success: "Credential deleted" });
                }}
                onReveal={reveal}
              />
            ))}
          </div>
        )}
      </Section>

      {partnerItems.length > 0 && deliveries && (
        <Section
          title="MHub handshake"
          icon={Webhook}
          count={deliveries.total}
          description={deliveries.dead ? `${deliveries.dead} dead-lettered` : deliveries.pending ? `${deliveries.pending} pending` : "all delivered"}
          actions={<Link href={OPS.clientTab(tenantId, "activity")} className="text-sm text-primary hover:underline">All deliveries →</Link>}
        >
          {deliveries.recent.length === 0 ? (
            <EmptyState icon={Webhook} title="No MHub deliveries yet" description="The provisioning handshake is queued when a marketing subscription activates." />
          ) : (
            <div className="flex flex-col gap-2">
              {deliveries.recent.slice(0, 5).map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm">
                  <StatusBadge kind="webhook" status={d.status} />
                  <span className="font-medium text-heading">{d.event}</span>
                  <span className="text-xs text-muted-foreground">attempt {d.attemptCount} · {formatDateTime(d.createdAt)}</span>
                  {d.lastError && <span className="text-xs text-destructive">{d.lastError}</span>}
                  {canMutate && (d.status === "dead" || d.status === "disabled") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto gap-1"
                      disabled={isPending(`requeue:${d.id}`)}
                      onClick={() => void run(() => requeueDeliveryAction(d.id), { key: `requeue:${d.id}`, success: "Requeued — the worker retries within a minute" })}
                    >
                      <RotateCcw className="size-3" /> Requeue
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <Dialog open={!!credFor} onOpenChange={(o) => !o && setCredFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{credFor?.cred ? "Edit credential" : "Add credential"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Kind</Label>
                <Select value={credForm.kind} onValueChange={(v) => setCredForm({ ...credForm, kind: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="registrar">Domain registrar</SelectItem>
                    <SelectItem value="dns">DNS provider</SelectItem>
                    <SelectItem value="email">Email provider</SelectItem>
                    <SelectItem value="hosting">Web hosting</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Label</Label>
                <Input value={credForm.label} onChange={(e) => setCredForm({ ...credForm, label: e.target.value })} placeholder="GoDaddy account" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>URL</Label>
              <Input value={credForm.url} onChange={(e) => setCredForm({ ...credForm, url: e.target.value })} placeholder="https://…" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Username</Label>
                <Input value={credForm.username} onChange={(e) => setCredForm({ ...credForm, username: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>{credFor?.cred?.hasSecret ? "New secret (blank = keep)" : "Secret"}</Label>
                <Input type="password" value={credForm.secret} onChange={(e) => setCredForm({ ...credForm, secret: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Secrets are AES-256-GCM encrypted at rest; every reveal is logged to the audit trail with your name.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={saveCred} disabled={!credForm.label || isPending("cred")}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProvisioningCard({
  item,
  readOnly,
  revealed,
  pending,
  onSaveDomain,
  onConfigure,
  onVerify,
  onSaveConfig,
  onAddCred,
  onEditCred,
  onDeleteCred,
  onReveal,
}: {
  tenantId: string;
  item: ProvisioningView;
  /** ops_support: show everything, change nothing. */
  readOnly: boolean;
  revealed: Record<string, string>;
  pending: (key: string) => boolean;
  onSaveDomain: (value: string) => void;
  onConfigure: () => void;
  onVerify: () => void;
  onSaveConfig: (form: { token: string; cname: string; ips: string }) => void;
  onAddCred: () => void;
  onEditCred: (cred: Cred) => void;
  onDeleteCred: (cred: Cred) => void;
  onReveal: (credId: string) => void;
}) {
  const [domain, setDomain] = useState(item.domainUrl ?? "");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [config, setConfig] = useState({
    token: item.verifyToken ?? "",
    cname: item.expectedCname ?? "",
    ips: item.expectedAIps ?? "",
  });
  const records = item.domainUrl
    ? buildDnsRecords({
        host: hostFromUrl(item.domainUrl),
        verifyToken: item.verifyToken,
        expectedCname: item.expectedCname,
        expectedAIps: item.expectedAIps,
      })
    : [];

  return (
    <Card className="gap-4 py-5">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="size-4 text-primary" />
          <Link href={OPS.product(item.productId)} className="hover:text-primary">{item.productName}</Link>
          <StatusBadge kind="dns" status={item.state} label={item.state === "provisioned" ? "provisioned by MHub" : undefined} />
        </CardTitle>
        {!item.managedByPartner && item.dnsLastVerifiedAt && (
          <span className="text-xs text-muted-foreground">last checked {formatDate(item.dnsLastVerifiedAt)}</span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{STATE_HINT[item.state]}</p>

        {item.managedByPartner ? (
          item.domainUrl && (
            <p className="text-sm">
              Portal:{" "}
              <a href={item.domainUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                {item.domainUrl}
              </a>
            </p>
          )
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-64 flex-1 gap-2">
                <Label htmlFor={`domain-${item.subscriptionId}`}>Live domain</Label>
                <Input id={`domain-${item.subscriptionId}`} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="https://customer-site.com" disabled={readOnly} />
              </div>
              {!readOnly && (
                <>
                  <Button variant="outline" disabled={pending("domain") || domain.trim() === (item.domainUrl ?? "")} onClick={() => onSaveDomain(domain.trim())}>
                    {pending("domain") ? "Saving…" : "Save domain"}
                  </Button>
                  {item.state === "unconfigured" ? (
                    <Button className="gap-1" disabled={pending("configure")} onClick={onConfigure}>
                      <ShieldCheck className="size-4" /> {pending("configure") ? "Configuring…" : "Configure verification"}
                    </Button>
                  ) : (
                    item.domainUrl && (
                      <Button className="gap-1" disabled={pending("verify")} onClick={onVerify}>
                        <ShieldCheck className="size-4" /> {pending("verify") ? "Checking…" : "Verify DNS"}
                      </Button>
                    )
                  )}
                </>
              )}
            </div>

            {records.length > 0 && (
              <div className="rounded-md border bg-secondary/30 p-3">
                <div className="mb-2 flex items-center justify-between text-sm font-medium text-heading">
                  Records to add at the client&apos;s DNS provider
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1"
                    onClick={() => {
                      navigator.clipboard.writeText(records.map((r) => `${r.type}\t${r.host}\t${r.value}`).join("\n"));
                      toast.success("Records copied");
                    }}
                  >
                    <Copy className="size-3.5" /> Copy all
                  </Button>
                </div>
                <div className="grid gap-1 font-mono text-xs">
                  {records.map((r, i) => (
                    <div key={i} className="grid grid-cols-[4rem_1fr_2fr] items-center gap-2 rounded bg-background px-2 py-1">
                      <span className="text-heading">{r.type}</span>
                      <span className="truncate text-muted-foreground">{r.host}</span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate">{r.value}</span>
                        {r.note && <span className="shrink-0 font-sans text-[10px] text-muted-foreground">{r.note}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {item.dnsLastResolved && (
              <p className={`text-xs ${item.state === "failing" ? "text-destructive" : "text-muted-foreground"}`}>
                Last resolved: {item.dnsLastResolved}
              </p>
            )}

            <button type="button" className="w-fit text-xs text-muted-foreground hover:text-heading" onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? "Hide verification settings" : "Edit verification (advanced)"}
            </button>
            {showAdvanced && (
              <div className="grid gap-3 rounded-md border p-3">
                <div className="grid gap-2">
                  <Label>Ownership token (TXT: plaidware-verify=…)</Label>
                  <Input value={config.token} onChange={(e) => setConfig({ ...config, token: e.target.value })} placeholder="uuid or full plaidware-verify=… string" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Expected CNAME</Label>
                    <Input value={config.cname} onChange={(e) => setConfig({ ...config, cname: e.target.value })} placeholder="edge.railway.app" />
                  </div>
                  <div className="grid gap-2">
                    <Label>A-record allow-list (comma-separated)</Label>
                    <Input value={config.ips} onChange={(e) => setConfig({ ...config, ips: e.target.value })} placeholder="1.2.3.4, 5.6.7.8" />
                  </div>
                </div>
                {!readOnly && (
                  <Button size="sm" className="w-fit" disabled={pending("config")} onClick={() => onSaveConfig(config)}>
                    Save settings
                  </Button>
                )}
              </div>
            )}
          </>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-medium text-heading">
              <KeyRound className="size-4" /> Credentials
            </span>
            {!readOnly && (
              <Button variant="outline" size="sm" className="gap-1" onClick={onAddCred}>
                <Plus className="size-4" /> Add
              </Button>
            )}
          </div>
          {item.credentials.length === 0 && <p className="text-xs text-muted-foreground">None stored.</p>}
          <div className="flex flex-col gap-1.5">
            {item.credentials.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <div>
                  <span className="font-medium text-heading">{c.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{c.kind}{c.username ? ` · ${c.username}` : ""}</span>
                  {revealed[c.id] && (
                    <div className="mt-1 font-mono text-xs text-warning">{revealed[c.id]} <span className="text-muted-foreground">(hides in 30s)</span></div>
                  )}
                </div>
                <div className="flex gap-1">
                  {c.url && (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={c.url} target="_blank" rel="noreferrer">Open</a>
                    </Button>
                  )}
                  {!readOnly && (
                    <>
                      {c.hasSecret && !revealed[c.id] && (
                        <Button variant="ghost" size="icon" title="Reveal (audited)" onClick={() => onReveal(c.id)}>
                          <Eye className="size-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => onEditCred(c)}>Edit</Button>
                      <Button variant="ghost" size="icon" disabled={pending(`delcred:${c.id}`)} onClick={() => onDeleteCred(c)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
