import { redirect } from "next/navigation";
import { getSession, isOps } from "@/policy";
import { listPlatformUsers } from "@/modules/tenancy/queries";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Access" };

export default async function OpsUsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOps(session)) redirect("/dashboard");

  const users = await listPlatformUsers();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-heading">Access</h1>
        <p className="text-sm text-muted-foreground">
          Every account on the platform, with workspace memberships.
        </p>
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Platform role</TableHead>
              <TableHead className="hidden sm:table-cell">Verified</TableHead>
              <TableHead className="hidden md:table-cell">Workspaces</TableHead>
              <TableHead className="hidden md:table-cell">Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium text-heading">{u.name}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={u.platformRole === "ops_admin" ? "default" : "secondary"}>
                    {u.platformRole}
                  </Badge>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {u.emailVerified ? (
                    <span className="text-success">verified</span>
                  ) : (
                    <span className="text-warning">pending</span>
                  )}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {u.tenants.join(", ") || "—"}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {u.createdAt.toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
