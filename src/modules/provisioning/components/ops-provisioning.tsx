"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, Globe, KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import {
  deleteCredentialAction,
  revealCredentialAction,
  runDnsVerifyAction,
  setDomainAction,
  setVerifyConfigAction,
  upsertCredentialAction,
} from "../actions";
import { Badge } from "@/components/ui/badge";
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

export type ProvisioningView = {
  subscriptionId: string;
  productName: string;
  domainUrl: string | null;
  hasVerifyToken: boolean;
  verifyToken: string | null;
  expectedCname: string | null;
  expectedAIps: string | null;
  dnsLastOk: boolean | null;
  dnsLastVerifiedAt: string | null;
  dnsLastResolved: string | null;
  credentials: {
    id: string;
    kind: string;
    label: string;
    url: string | null;
    username: string | null;
    hasSecret: boolean;
  }[];
};

export type TimelineView = {
  id: string;
  kind: string;
  actorName: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
}[];

const KIND_LABEL: Record<string, string> = {
  domain_changed: "Domain changed",
  dns_verified: "DNS verified",
  dns_config_changed: "DNS config updated",
  credential_added: "Credential added",
  credential_updated: "Credential updated",
  credential_deleted: "Credential deleted",
  credential_revealed: "Credential revealed",
};

export function OpsProvisioning({
  tenantId,
  items,
  timeline,
}: {
  tenantId: string;
  items: ProvisioningView[];
  timeline: TimelineView;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [credFor, setCredFor] = useState<{ subscriptionId: string; cred?: ProvisioningView["credentials"][number] } | null>(null);
  const [credForm, setCredForm] = useState({ kind: "hosting", label: "", url: "", username: "", secret: "" });
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  async function saveDomain(item: ProvisioningView, value: string) {
    const res = await setDomainAction({
      tenantId,
      subscriptionId: item.subscriptionId,
      domainUrl: value || null,
    });
    if (res.ok) {
      toast.success(value ? "Domain saved" : "Domain cleared");
      router.refresh();
    } else toast.error(res.error);
  }

  async function verify(item: ProvisioningView) {
    setBusy(item.subscriptionId);
    const res = await runDnsVerifyAction(item.subscriptionId);
    setBusy(null);
    if (res.ok) {
      if (res.passed) toast.success(`DNS verified (${res.mode})`);
      else toast.warning(res.detail);
      router.refresh();
    } else toast.error(res.error);
  }

  async function saveConfig(item: ProvisioningView, form: { token: string; cname: string; ips: string }) {
    const res = await setVerifyConfigAction({
      subscriptionId: item.subscriptionId,
      verifyToken: form.token || null,
      expectedCname: form.cname || null,
      expectedAIps: form.ips || null,
    });
    if (res.ok) {
      toast.success("Verification config saved");
      router.refresh();
    } else toast.error(res.error);
  }

  async function saveCred() {
    if (!credFor) return;
    const res = await upsertCredentialAction({
      id: credFor.cred?.id,
      subscriptionId: credFor.subscriptionId,
      kind: credForm.kind as "registrar" | "dns" | "email" | "hosting" | "other",
      label: credForm.label,
      url: credForm.url || undefined,
      username: credForm.username || undefined,
      secret: credForm.secret || undefined,
    });
    if (res.ok) {
      toast.success("Credential saved (encrypted at rest)");
      setCredFor(null);
      router.refresh();
    } else toast.error(res.error);
  }

  async function reveal(credId: string) {
    const res = await revealCredentialAction(credId);
    if (res.ok) {
      setRevealed((r) => ({ ...r, [credId]: res.secret }));
      toast.info("Reveal logged to the audit trail");
      setTimeout(() => setRevealed((r) => {
        const { [credId]: _drop, ...rest } = r;
        return rest;
      }), 30000);
    } else toast.error(res.error);
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-heading">Provisioning</h2>
      {items.map((item) => (
        <ProvisioningCard
          key={item.subscriptionId}
          item={item}
          busy={busy === item.subscriptionId}
          revealed={revealed}
          onSaveDomain={saveDomain}
          onVerify={verify}
          onSaveConfig={saveConfig}
          onAddCred={() => {
            setCredFor({ subscriptionId: item.subscriptionId });
            setCredForm({ kind: "hosting", label: "", url: "", username: "", secret: "" });
          }}
          onEditCred={(cred) => {
            setCredFor({ subscriptionId: item.subscriptionId, cred });
            setCredForm({ kind: cred.kind, label: cred.label, url: cred.url ?? "", username: cred.username ?? "", secret: "" });
          }}
          onDeleteCred={async (cred) => {
            if (!confirm(`Delete credential "${cred.label}"?`)) return;
            const res = await deleteCredentialAction(cred.id);
            if (res.ok) { toast.success("Credential deleted"); router.refresh(); }
            else toast.error(res.error);
          }}
          onReveal={reveal}
        />
      ))}

      {timeline.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {timeline.slice(0, 20).map((t) => (
              <div key={t.id} className="flex items-baseline justify-between gap-3 text-sm">
                <div>
                  <span className="text-heading">{KIND_LABEL[t.kind] ?? t.kind}</span>
                  {t.kind === "domain_changed" && (
                    <span className="text-muted-foreground"> → {String(t.payload.after ?? "cleared")}</span>
                  )}
                  {t.kind === "dns_verified" && (
                    <span className={t.payload.ok ? "text-success" : "text-warning"}>
                      {" "}{t.payload.ok ? "passed" : "failed"} ({String(t.payload.mode)})
                    </span>
                  )}
                  {t.actorName && <span className="text-muted-foreground"> · {t.actorName}</span>}
                </div>
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(t.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
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
              Secrets are AES-256-GCM encrypted at rest; every reveal is logged
              to the audit trail with your name.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={saveCred} disabled={!credForm.label}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProvisioningCard({
  item, busy, revealed,
  onSaveDomain, onVerify, onSaveConfig, onAddCred, onEditCred, onDeleteCred, onReveal,
}: {
  item: ProvisioningView;
  busy: boolean;
  revealed: Record<string, string>;
  onSaveDomain: (item: ProvisioningView, value: string) => void;
  onVerify: (item: ProvisioningView) => void;
  onSaveConfig: (item: ProvisioningView, form: { token: string; cname: string; ips: string }) => void;
  onAddCred: () => void;
  onEditCred: (cred: ProvisioningView["credentials"][number]) => void;
  onDeleteCred: (cred: ProvisioningView["credentials"][number]) => void;
  onReveal: (credId: string) => void;
}) {
  const [domain, setDomain] = useState(item.domainUrl ?? "");
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState({
    token: item.verifyToken ?? "",
    cname: item.expectedCname ?? "",
    ips: item.expectedAIps ?? "",
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="size-4 text-primary" /> {item.productName}
        </CardTitle>
        {item.dnsLastOk != null && (
          <Badge variant={item.dnsLastOk ? "secondary" : "destructive"}>
            DNS {item.dnsLastOk ? "verified" : "failing"}
            {item.dnsLastVerifiedAt && ` · ${new Date(item.dnsLastVerifiedAt).toLocaleDateString()}`}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-64 flex-1 gap-2">
            <Label>Live domain</Label>
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="https://customer-site.com" />
          </div>
          <Button variant="outline" onClick={() => onSaveDomain(item, domain.trim())}>Save</Button>
          <Button onClick={() => onVerify(item)} disabled={busy || !item.domainUrl} className="gap-1">
            <ShieldCheck className="size-4" /> {busy ? "Checking…" : "Verify DNS"}
          </Button>
          <Button variant="ghost" onClick={() => setShowConfig(!showConfig)}>
            {showConfig ? "Hide config" : "Verify config"}
          </Button>
        </div>
        {item.dnsLastResolved && (
          <p className="text-xs text-muted-foreground">Last resolved: {item.dnsLastResolved}</p>
        )}

        {showConfig && (
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
                <Label>A-record allow-list (comma-sep)</Label>
                <Input value={config.ips} onChange={(e) => setConfig({ ...config, ips: e.target.value })} placeholder="1.2.3.4, 5.6.7.8" />
              </div>
            </div>
            <Button size="sm" className="w-fit" onClick={() => onSaveConfig(item, config)}>Save config</Button>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-medium text-heading">
              <KeyRound className="size-4" /> Credentials
            </span>
            <Button variant="outline" size="sm" className="gap-1" onClick={onAddCred}>
              <Plus className="size-4" /> Add
            </Button>
          </div>
          {item.credentials.length === 0 && (
            <p className="text-xs text-muted-foreground">None stored.</p>
          )}
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
                  {c.hasSecret && !revealed[c.id] && (
                    <Button variant="ghost" size="icon" title="Reveal (audited)" onClick={() => onReveal(c.id)}>
                      <Eye className="size-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => onEditCred(c)}>Edit</Button>
                  <Button variant="ghost" size="icon" onClick={() => onDeleteCred(c)}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
