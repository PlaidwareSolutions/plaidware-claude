import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, isOps } from "@/policy";
import { getUserTenants, listMembers } from "@/modules/tenancy/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (isOps(session)) redirect("/ops");

  const tenants = await getUserTenants(session.user.id);
  const active =
    tenants.find((t) => t.id === session.session.activeOrganizationId) ?? tenants[0];

  if (!active) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-16 text-center">
        <h1 className="text-2xl font-semibold text-heading">Welcome to Plaidware</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have a workspace yet. One is created for you when you
          subscribe to your first product, or when your team invites you.
        </p>
        <Button asChild>
          <Link href="/products">Browse the catalog</Link>
        </Button>
      </div>
    );
  }

  const members = await listMembers(active.id);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-heading">{active.name}</h1>
        <Badge variant={active.status === "active" ? "secondary" : "destructive"}>
          {active.status}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Team members</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{members.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href="/team">Manage team</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Products</CardDescription>
            <CardTitle className="text-3xl tabular-nums">—</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Subscriptions arrive with checkout (M3).
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Open invoices</CardDescription>
            <CardTitle className="text-3xl tabular-nums">—</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Billing arrives in M3.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
