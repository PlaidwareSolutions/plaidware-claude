"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import type { OpsTenantRow } from "../queries";
import { opsDeleteTenantAction, opsSetTenantStatusAction } from "../actions";
import { OPS } from "@/lib/routes";
import { formatDate } from "@/lib/dates";
import { useAction } from "@/lib/use-action";
import { StatusBadge } from "@/components/status-badge";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOpsAccess } from "@/components/ops-access";

export function OpsClientsTable({ tenants }: { tenants: OpsTenantRow[] }) {
  const { run, isPending } = useAction();
  const { canMutate } = useOpsAccess();
  const [busy, setBusy] = useState(false);
  const [deleteFor, setDeleteFor] = useState<OpsTenantRow | null>(null);
  const [confirmSlug, setConfirmSlug] = useState("");

  async function doDelete() {
    if (!deleteFor) return;
    setBusy(true);
    const res = await opsDeleteTenantAction(deleteFor.id, confirmSlug);
    setBusy(false);
    if (res.ok) {
      toast.success(`Workspace "${deleteFor.name}" deleted`);
      setDeleteFor(null);
      setConfirmSlug("");
    } else {
      toast.error(res.error ?? "Delete failed");
    }
  }

  const toolbar = (
    <span className="text-sm text-muted-foreground">
      {tenants.length} client{tenants.length === 1 ? "" : "s"}
    </span>
  );

  return (
    <>
      <DataTableShell toolbar={toolbar}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Members</TableHead>
              <TableHead className="hidden md:table-cell">Created</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.length === 0 && (
              <TableEmpty
                colSpan={5}
                icon={Building2}
                title="No clients yet"
                description="Onboard your first client to create their workspace, products, and setup link."
              />
            )}
            {tenants.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <Link href={OPS.client(t.id)} className="font-medium text-heading hover:text-primary">
                    {t.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{t.slug}</div>
                </TableCell>
                <TableCell>
                  <StatusBadge kind="tenant" status={t.status} />
                </TableCell>
                <TableCell className="hidden tabular-nums sm:table-cell">{t.memberCount}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {formatDate(t.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  {canMutate ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" disabled={isPending(`status:${t.id}`)}>
                        Manage
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={OPS.client(t.id)}>Open client</Link>
                      </DropdownMenuItem>
                      {t.status !== "active" && (
                        <DropdownMenuItem
                          onClick={() => void run(() => opsSetTenantStatusAction(t.id, "active"), { key: `status:${t.id}`, success: `${t.name} is now active` })}
                        >
                          Activate
                        </DropdownMenuItem>
                      )}
                      {t.status !== "suspended" && (
                        <DropdownMenuItem
                          onClick={() => void run(() => opsSetTenantStatusAction(t.id, "suspended"), { key: `status:${t.id}`, success: `${t.name} is now suspended` })}
                        >
                          Suspend
                        </DropdownMenuItem>
                      )}
                      {t.status !== "inactive" && (
                        <DropdownMenuItem
                          onClick={() => void run(() => opsSetTenantStatusAction(t.id, "inactive"), { key: `status:${t.id}`, success: `${t.name} is now inactive` })}
                        >
                          Deactivate
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => {
                          setDeleteFor(t);
                          setConfirmSlug("");
                        }}
                      >
                        Delete…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  ) : (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={OPS.client(t.id)}>Open</Link>
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTableShell>

      <Dialog open={!!deleteFor} onOpenChange={(o) => !o && setDeleteFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteFor?.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the workspace with its members, subscriptions, invoices,
              and provisioning records. Stripe records are not touched. Type the slug{" "}
              <span className="font-mono text-heading">{deleteFor?.slug}</span> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            id="confirm-slug"
            autoFocus
            placeholder={deleteFor?.slug}
            value={confirmSlug}
            onChange={(e) => setConfirmSlug(e.target.value)}
          />
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={doDelete}
              disabled={busy || !deleteFor || confirmSlug !== deleteFor.slug}
            >
              {busy ? "Deleting…" : "Delete workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
