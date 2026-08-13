"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Building2, Plus } from "lucide-react";
import type { OpsTenantRow } from "../queries";
import {
  opsCreateTenantAction,
  opsDeleteTenantAction,
  opsSetTenantStatusAction,
} from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

function statusVariant(status: string) {
  if (status === "active") return "secondary" as const;
  if (status === "suspended") return "destructive" as const;
  return "outline" as const;
}

export function OpsTenants({ tenants }: { tenants: OpsTenantRow[] }) {
  const [, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", ownerEmail: "" });
  const [busy, setBusy] = useState(false);
  const [deleteFor, setDeleteFor] = useState<OpsTenantRow | null>(null);
  const [confirmSlug, setConfirmSlug] = useState("");

  async function create() {
    setBusy(true);
    const res = await opsCreateTenantAction(form);
    setBusy(false);
    if (res.ok) {
      toast.success(`Tenant "${form.name}" created`);
      setCreateOpen(false);
      setForm({ name: "", slug: "", ownerEmail: "" });
    } else {
      toast.error(res.error ?? "Create failed");
    }
  }

  function setStatus(t: OpsTenantRow, status: "active" | "suspended" | "inactive") {
    startTransition(async () => {
      const res = await opsSetTenantStatusAction(t.id, status);
      if (res.ok) toast.success(`${t.name} is now ${status}`);
      else toast.error(res.error ?? "Update failed");
    });
  }

  async function doDelete() {
    if (!deleteFor) return;
    setBusy(true);
    const res = await opsDeleteTenantAction(deleteFor.id, confirmSlug);
    setBusy(false);
    if (res.ok) {
      toast.success(`Tenant "${deleteFor.name}" deleted`);
      setDeleteFor(null);
      setConfirmSlug("");
    } else {
      toast.error(res.error ?? "Delete failed");
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-heading">Tenants</h1>
          <p className="text-sm text-muted-foreground">
            Every customer organization on the platform.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="size-4" /> Create tenant
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a tenant</DialogTitle>
              <DialogDescription>
                The owner must already have a Plaidware account. The full
                onboarding wizard (user + subscription in one step) arrives in a
                later milestone.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="t-name">Name</Label>
                <Input id="t-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="t-slug">Slug (optional)</Label>
                <Input id="t-slug" placeholder="derived from name" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="t-owner">Owner email</Label>
                <Input id="t-owner" type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={create} disabled={busy || !form.name || !form.ownerEmail}>
                {busy ? "Creating…" : "Create tenant"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Members</TableHead>
              <TableHead className="hidden md:table-cell">Created</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  <Building2 className="mx-auto mb-2 size-8 opacity-40" />
                  No tenants yet.
                </TableCell>
              </TableRow>
            )}
            {tenants.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <a href={`/ops/tenants/${t.id}`} className="font-medium text-heading hover:text-primary">
                    {t.name}
                  </a>
                  <div className="text-xs text-muted-foreground">{t.slug}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                </TableCell>
                <TableCell className="hidden tabular-nums sm:table-cell">{t.memberCount}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {t.createdAt.toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        Manage
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {t.status !== "active" && (
                        <DropdownMenuItem onClick={() => setStatus(t, "active")}>Activate</DropdownMenuItem>
                      )}
                      {t.status !== "suspended" && (
                        <DropdownMenuItem onClick={() => setStatus(t, "suspended")}>Suspend</DropdownMenuItem>
                      )}
                      {t.status !== "inactive" && (
                        <DropdownMenuItem onClick={() => setStatus(t, "inactive")}>Deactivate</DropdownMenuItem>
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!deleteFor} onOpenChange={(open) => !open && setDeleteFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteFor?.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the tenant, its memberships, and pending
              invitations. Type the slug{" "}
              <span className="font-mono text-foreground">{deleteFor?.slug}</span> to
              confirm.
            </DialogDescription>
          </DialogHeader>
          <Input value={confirmSlug} onChange={(e) => setConfirmSlug(e.target.value)} placeholder={deleteFor?.slug} />
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={busy || confirmSlug !== deleteFor?.slug}
              onClick={doDelete}
            >
              {busy ? "Deleting…" : "Delete tenant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
