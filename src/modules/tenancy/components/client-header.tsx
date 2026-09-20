"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Activity,
  CreditCard,
  ExternalLink,
  MessageSquare,
  MoreHorizontal,
  Receipt,
  Trash2,
} from "lucide-react";
import type { ClientHeader as ClientHeaderDto } from "../queries";
import {
  opsDeleteTenantAction,
  opsDeleteTenantPreviewAction,
  opsSetTenantStatusAction,
} from "../actions";
import { OPS, stripeCustomerUrl, withQuery } from "@/lib/routes";
import { formatDate } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { useConfirm } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ClientTabs } from "./client-tabs";
import { useOpsAccess } from "@/components/ops-access";

type Preview = {
  members: number;
  subscriptions: number;
  liveSubscriptions: number;
  invoices: number;
  openInvoices: number;
  setupInvites: number;
};

export function ClientHeader({
  client,
  stripeTestMode,
}: {
  client: ClientHeaderDto;
  stripeTestMode: boolean;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const { canMutate } = useOpsAccess();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function setStatus(status: "active" | "suspended" | "inactive") {
    const copy = {
      suspended: {
        title: `Suspend ${client.name}?`,
        description:
          "Members can still sign in to pay invoices, but every other page becomes read-only and add-ons, invites, and domain changes are blocked. Subscriptions keep billing unless you also suspend them.",
        confirmLabel: "Suspend workspace",
        destructive: true,
      },
      inactive: {
        title: `Deactivate ${client.name}?`,
        description: "Members get read-only access to everything, including billing. Use this for a client that has fully churned.",
        confirmLabel: "Deactivate workspace",
        destructive: true,
      },
      active: {
        title: `Reactivate ${client.name}?`,
        description: "Members regain full access according to their roles.",
        confirmLabel: "Reactivate",
        destructive: false,
      },
    }[status];
    const r = await confirm({
      ...copy,
      field: { label: "Note for the activity log (optional)", placeholder: "Why" },
    });
    if (!r) return;
    void run(() => opsSetTenantStatusAction(client.id, status, r.value), {
      key: "status",
      success: `${client.name} is now ${status}`,
    });
  }

  async function openDelete() {
    const res = await opsDeleteTenantPreviewAction(client.id);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setConfirmSlug("");
    setPreview(res);
  }

  async function doDelete() {
    setDeleting(true);
    const res = await opsDeleteTenantAction(client.id, confirmSlug);
    setDeleting(false);
    if (res.ok) {
      toast.success(`${client.name} deleted`);
      router.push(OPS.clients);
    } else toast.error(res.error);
  }

  const blocked = (preview?.liveSubscriptions ?? 0) > 0;

  return (
    <>
      <PageHeader
        back={{ href: OPS.clients, label: "Clients" }}
        title={client.name}
        badge={
          <>
            <StatusBadge kind="tenant" status={client.status} />
            {client.hasMarketing && (
              <Badge variant="outline" title="Holds a live Marketing Ops Hub subscription">
                MHub
              </Badge>
            )}
          </>
        }
        meta={
          <>
            {client.slug}
            {client.ownerEmail && <> · {client.ownerName ?? client.ownerEmail} · {client.ownerEmail}</>}
            {" · "}
            {client.memberCount} member{client.memberCount === 1 ? "" : "s"} · since {formatDate(client.createdAt)}
          </>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={withQuery(OPS.subscriptions, { q: client.slug })}>
                <Receipt className="size-4" /> Subscriptions
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={withQuery(OPS.monitoring, { tenant: client.id })}>
                <Activity className="size-4" /> Monitoring
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={withQuery(OPS.inbox, { tenant: client.id })}>
                <MessageSquare className="size-4" /> Inbox
              </Link>
            </Button>
            {client.stripeCustomerId && (
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a href={stripeCustomerUrl(client.stripeCustomerId, stripeTestMode)} target="_blank" rel="noreferrer">
                  <CreditCard className="size-4" /> Stripe <ExternalLink className="size-3" />
                </a>
              </Button>
            )}
            {canMutate && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="size-8 p-0" aria-label="Workspace actions" disabled={pending}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Workspace</DropdownMenuLabel>
                {client.status !== "active" && (
                  <DropdownMenuItem onSelect={() => void setStatus("active")}>Reactivate workspace</DropdownMenuItem>
                )}
                {client.status !== "suspended" && (
                  <DropdownMenuItem onSelect={() => void setStatus("suspended")}>Suspend workspace…</DropdownMenuItem>
                )}
                {client.status !== "inactive" && (
                  <DropdownMenuItem onSelect={() => void setStatus("inactive")}>Deactivate workspace…</DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void openDelete()}>
                  <Trash2 className="size-4" /> Delete workspace…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            )}
          </>
        }
      >
        <ClientTabs id={client.id} />
      </PageHeader>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {client.name}?</DialogTitle>
            <DialogDescription>
              Permanently removes the workspace and everything attached to it. Stripe records are not touched.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <li className="flex justify-between"><span className="text-muted-foreground">Members</span><span className="tabular-nums">{preview.members}</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Subscriptions</span><span className="tabular-nums">{preview.subscriptions}</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Invoices</span><span className="tabular-nums">{preview.invoices}</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Open invoices</span><span className="tabular-nums">{preview.openInvoices}</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Setup links</span><span className="tabular-nums">{preview.setupInvites}</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Live subscriptions</span><span className={`tabular-nums ${blocked ? "font-semibold text-destructive" : ""}`}>{preview.liveSubscriptions}</span></li>
            </ul>
          )}
          {blocked ? (
            <p className="text-sm text-destructive">
              Cancel the live subscription{preview!.liveSubscriptions === 1 ? "" : "s"} first — deleting now would leave Stripe billing a client that no longer exists here.
            </p>
          ) : (
            <div className="grid gap-2">
              <p className="text-sm text-muted-foreground">
                Type <span className="font-mono text-heading">{client.slug}</span> to confirm.
              </p>
              <Input id="confirm-slug" autoFocus placeholder={client.slug} value={confirmSlug} onChange={(e) => setConfirmSlug(e.target.value)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>Keep workspace</Button>
            <Button variant="destructive" onClick={doDelete} disabled={deleting || blocked || confirmSlug !== client.slug}>
              {deleting ? "Deleting…" : "Delete workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
