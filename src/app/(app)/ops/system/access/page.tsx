import Link from "next/link";
import { requireOpsPage } from "@/policy";
import { listPlatformUsers } from "@/modules/tenancy/queries";
import { OPS } from "@/lib/routes";
import { formatDate } from "@/lib/dates";
import { StatusBadge } from "@/components/status-badge";
import { DataTableShell, TableEmpty } from "@/components/data-table-shell";
import { Users } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Access · System" };
export const dynamic = "force-dynamic";

export default async function OpsAccessPage() {
  await requireOpsPage();
  const users = await listPlatformUsers();

  return (
    <DataTableShell footer={`${users.length} account${users.length === 1 ? "" : "s"} — every sign-in on the platform, with workspace memberships.`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Platform role</TableHead>
            <TableHead className="hidden sm:table-cell">Email</TableHead>
            <TableHead className="hidden md:table-cell">Workspaces</TableHead>
            <TableHead className="hidden md:table-cell">Joined</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.length === 0 && <TableEmpty colSpan={5} icon={Users} title="No accounts yet" />}
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                <div className="font-medium text-heading">{u.name}</div>
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </TableCell>
              <TableCell>
                <StatusBadge kind="platformRole" status={u.platformRole} />
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <StatusBadge kind="verification" status={u.emailVerified ? "verified" : "pending"} />
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                {u.tenants.length === 0
                  ? "—"
                  : u.tenants.map((t, i) => (
                      <span key={t.id}>
                        {i > 0 && ", "}
                        <Link href={OPS.client(t.id)} className="hover:text-primary">{t.name}</Link>
                      </span>
                    ))}
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                {formatDate(u.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataTableShell>
  );
}
