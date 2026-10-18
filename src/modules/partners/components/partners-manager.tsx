"use client";

import { useState } from "react";
import { Copy, KeyRound, Plug, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createPartnerAppAction,
  mintPartnerKeyAction,
  revokePartnerKeyAction,
  rotatePartnerSecretAction,
  setPartnerAppStatusAction,
  updatePartnerAppAction,
} from "../actions";
import type { PartnerAppOpsDto } from "../queries";

const splitList = (v: string) => v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

type Form = { name: string; displayName: string; prefixes: string; webhookUrl: string; provisionUrl: string; billingUrl: string; origins: string };
const EMPTY: Form = { name: "", displayName: "", prefixes: "", webhookUrl: "", provisionUrl: "", billingUrl: "", origins: "" };

/**
 * Ops → System → Partners: external apps Hub bills for (docs/PARTNER-API.md).
 * Secrets and keys are shown exactly once, for the partner's env.
 */
export function PartnersManager({ apps, canEdit }: { apps: PartnerAppOpsDto[]; canEdit: boolean }) {
  const { run, isPending } = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<PartnerAppOpsDto | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [reveal, setReveal] = useState<{ title: string; value: string; hint: string } | null>(null);

  function openEditor(app: PartnerAppOpsDto | "new") {
    setEditing(app);
    setForm(
      app === "new"
        ? EMPTY
        : {
            name: app.name,
            displayName: app.displayName,
            prefixes: app.productPrefixes.join(", "),
            webhookUrl: app.webhookUrl ?? "",
            provisionUrl: app.provisionUrl ?? "",
            billingUrl: app.billingUrl ?? "",
            origins: app.allowedReturnOrigins.join("\n"),
          },
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const input = {
      displayName: form.displayName,
      productPrefixes: splitList(form.prefixes),
      webhookUrl: form.webhookUrl,
      provisionUrl: form.provisionUrl,
      billingUrl: form.billingUrl,
      allowedReturnOrigins: splitList(form.origins),
    };
    const res =
      editing === "new"
        ? await run(() => createPartnerAppAction({ ...input, name: form.name }), { key: "save", success: "Partner app created" })
        : await run(() => updatePartnerAppAction((editing as PartnerAppOpsDto).id, input), { key: "save", success: "Saved" });
    if (res?.ok) setEditing(null);
  }

  async function rotate(app: PartnerAppOpsDto) {
    if (app.hasSecret) {
      const ok = await confirm({
        title: `Rotate ${app.displayName}'s webhook secret?`,
        description: "Deliveries are signed with the new secret at once — the partner must update its env, or it will reject them until it does (they retry).",
        confirmLabel: "Rotate",
        destructive: true,
      });
      if (!ok) return;
    }
    const res = await run(() => rotatePartnerSecretAction(app.id), { key: `rotate:${app.id}` });
    if (res?.ok) setReveal({ title: "Webhook secret", value: res.secret, hint: "Set as the partner's HUB_WEBHOOK_SECRET. It won't be shown again." });
  }

  async function mint(app: PartnerAppOpsDto) {
    const ok = await confirm({
      title: `Mint an API key for ${app.displayName}`,
      field: { label: "Label", placeholder: `${app.name}-production`, required: true },
      confirmLabel: "Mint key",
    });
    if (!ok) return;
    const res = await run(() => mintPartnerKeyAction(app.id, ok.value ?? ""), { key: `mint:${app.id}` });
    if (res?.ok) setReveal({ title: "Partner API key", value: res.raw, hint: "Set as the partner's HUB_PARTNER_KEY. It won't be shown again." });
  }

  async function revoke(app: PartnerAppOpsDto, key: PartnerAppOpsDto["keys"][number]) {
    const ok = await confirm({
      title: `Revoke ${key.prefix}…?`,
      description: `${app.displayName} calls using this key fail with 401 immediately.`,
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (ok) await run(() => revokePartnerKeyAction(key.id), { key: `revoke:${key.id}`, success: "Key revoked" });
  }

  async function toggle(app: PartnerAppOpsDto) {
    const disabling = app.status === "active";
    const ok = await confirm({
      title: `${disabling ? "Disable" : "Enable"} ${app.displayName}?`,
      description: disabling
        ? "Its API keys stop working and webhooks stop going out (they keep queueing and drain on re-enable)."
        : "API keys work again and queued webhooks start delivering.",
      confirmLabel: disabling ? "Disable" : "Enable",
      destructive: disabling,
    });
    if (ok) {
      await run(() => setPartnerAppStatusAction(app.id, disabling ? "disabled" : "active"), {
        key: `status:${app.id}`,
        success: disabling ? "Disabled" : "Enabled",
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Partner apps"
        icon={Plug}
        count={apps.length}
        description="External products Hub bills for (Partner API · docs/PARTNER-API.md). MHub is env-configured."
        actions={
          canEdit && (
            <Button size="sm" className="gap-2" onClick={() => openEditor("new")}>
              <Plus className="size-4" /> New partner app
            </Button>
          )
        }
      >
        {apps.length === 0 ? (
          <EmptyState icon={Plug} title="No partner apps yet" description="Create one for each external product whose tenants Hub bills, e.g. Fixorata." />
        ) : (
          apps.map((app) => (
            <div key={app.id} className="flex flex-col gap-4 rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-heading">{app.displayName}</h3>
                    <span className="font-mono text-xs text-muted-foreground">{app.name}</span>
                    <StatusBadge kind="partnerApp" status={app.status} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {app.productPrefixes.map((p) => (
                      <Badge key={p} variant="outline" className="font-mono text-[10px]">{p}*</Badge>
                    ))}
                    <span className="text-xs text-muted-foreground">· {app.linkedClients} linked client{app.linkedClients === 1 ? "" : "s"}</span>
                  </div>
                </div>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEditor(app)}>Edit</Button>
                    <Button size="sm" variant="outline" className="gap-2" disabled={isPending(`rotate:${app.id}`)} onClick={() => void rotate(app)}>
                      <RefreshCw className="size-3.5" /> {app.hasSecret ? "Rotate secret" : "Generate secret"}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-2" disabled={isPending(`mint:${app.id}`)} onClick={() => void mint(app)}>
                      <KeyRound className="size-3.5" /> Mint key
                    </Button>
                    <Button size="sm" variant="ghost" className={app.status === "active" ? "text-destructive" : ""} disabled={isPending(`status:${app.id}`)} onClick={() => void toggle(app)}>
                      {app.status === "active" ? "Disable" : "Enable"}
                    </Button>
                  </div>
                )}
              </div>

              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-muted-foreground">Webhook URL</dt>
                <dd className="break-all font-mono text-xs">{app.webhookUrl ?? <span className="text-warning">not set — deliveries queue</span>}</dd>
                {app.provisionUrl && (
                  <>
                    <dt className="text-muted-foreground">Provision URL</dt>
                    <dd className="break-all font-mono text-xs">{app.provisionUrl}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Billing page</dt>
                <dd className="break-all font-mono text-xs">{app.billingUrl ?? <span className="text-warning">not set — emails link to Hub</span>}</dd>
                <dt className="text-muted-foreground">Webhook secret</dt>
                <dd>{app.hasSecret ? "set" : <span className="text-warning">not set — deliveries queue</span>}</dd>
                <dt className="text-muted-foreground">Return origins</dt>
                <dd className="break-all font-mono text-xs">
                  {app.allowedReturnOrigins.length ? app.allowedReturnOrigins.join(" · ") : <span className="text-warning">none — pay and portal links are refused</span>}
                </dd>
              </dl>

              <DataTableShell>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>API key</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {app.keys.length === 0 ? (
                      <TableEmpty colSpan={4} icon={KeyRound} title="No keys yet" description="Mint one for the partner's env." />
                    ) : (
                      app.keys.map((k) => (
                        <TableRow key={k.id}>
                          <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                          <TableCell className="text-sm">{k.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{formatDate(k.createdAt)}</TableCell>
                          <TableCell className="text-right">
                            {k.revokedAt ? (
                              <span className="text-xs text-muted-foreground">revoked {formatDate(k.revokedAt)}</span>
                            ) : canEdit ? (
                              <Button size="sm" variant="ghost" className="text-destructive" disabled={isPending(`revoke:${k.id}`)} onClick={() => void revoke(app, k)}>
                                Revoke
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </DataTableShell>
            </div>
          ))
        )}
      </Section>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <form onSubmit={save} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{editing === "new" ? "New partner app" : `Edit ${form.displayName}`}</DialogTitle>
              <DialogDescription>Products whose slug starts with a prefix belong to this app: their billing is visible to it and their lifecycle events go to it.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="pa-name">Machine name</Label>
                <Input id="pa-name" value={form.name} disabled={editing !== "new"} placeholder="fixorata" className="font-mono" onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pa-display">Display name</Label>
                <Input id="pa-display" value={form.displayName} placeholder="Fixorata" onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pa-prefixes">Product-slug prefixes</Label>
              <Input id="pa-prefixes" value={form.prefixes} placeholder="fixorata" className="font-mono" onChange={(e) => setForm({ ...form, prefixes: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pa-webhook">Webhook URL</Label>
              <Input id="pa-webhook" value={form.webhookUrl} placeholder="https://fixorata.com/api/webhooks/plaidware-hub" className="font-mono text-xs" onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pa-provision">Provision URL (optional — defaults to the webhook URL)</Label>
              <Input id="pa-provision" value={form.provisionUrl} className="font-mono text-xs" onChange={(e) => setForm({ ...form, provisionUrl: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pa-billing">Billing page URL (Hub&apos;s billing emails link here)</Label>
              <Input id="pa-billing" value={form.billingUrl} placeholder="https://fixorata.com/billing" className="font-mono text-xs" onChange={(e) => setForm({ ...form, billingUrl: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pa-origins">Allowed return origins (one per line)</Label>
              <Textarea
                id="pa-origins"
                rows={3}
                value={form.origins}
                placeholder={"https://fixorata.com\nhttps://fixorata-claude-staging.up.railway.app"}
                className="font-mono text-xs"
                onChange={(e) => setForm({ ...form, origins: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={isPending("save") || !form.displayName.trim() || (editing === "new" && !form.name.trim())}>
                {editing === "new" ? "Create" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={reveal !== null} onOpenChange={(o) => !o && setReveal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reveal?.title}</DialogTitle>
            <DialogDescription>{reveal?.hint}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={reveal?.value ?? ""} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copy"
              onClick={() => {
                void navigator.clipboard.writeText(reveal?.value ?? "").then(() => toast.success("Copied"));
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setReveal(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
