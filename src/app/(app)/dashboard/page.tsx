import Link from "next/link";
import { Activity, Package, Receipt, Users } from "lucide-react";
import { getTenantContext } from "@/policy";
import { TENANT } from "@/lib/routes";
import { listMembers } from "@/modules/tenancy/queries";
import { listTenantInvoices, listTenantSubscriptions } from "@/modules/billing/queries";
import { latestHealthBySubscription } from "@/modules/monitoring/service";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Ops accounts without a workspace are sent to the ops portal by getTenantContext().
  const { active, caps } = await getTenantContext();

  if (!active || !caps) {
    return (
      <EmptyState
        icon={Package}
        title="Welcome to Plaidware"
        description="You don't have a workspace yet. One is created for you when you subscribe to your first product, or when your team invites you."
        action={
          <Button asChild>
            <Link href="/products">Browse the catalog</Link>
          </Button>
        }
        className="mx-auto mt-16 max-w-md"
      />
    );
  }

  const [members, subscriptions, invoices] = await Promise.all([
    listMembers(active.id),
    listTenantSubscriptions(active.id),
    listTenantInvoices(active.id),
  ]);
  const live = subscriptions.filter((s) => !["canceled", "expired"].includes(s.status));
  const health = await latestHealthBySubscription(live.map((s) => s.id));
  const openCents = invoices
    .filter((i) => i.status === "open" || i.status === "failed")
    .reduce((s, i) => s + i.amountDueCents, 0);
  const mrrCents = live.reduce((s, x) => s + x.monthlyCents, 0);
  const nextRenewal = live
    .map((s) => s.currentPeriodEnd)
    .filter((d): d is string => !!d)
    .sort()[0];
  const down = live.filter((s) => {
    const h = health.get(s.id);
    return h && h.status !== "healthy";
  }).length;
  const canBuy = caps.can("write"); // role and workspace status

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <PageHeader
        title={active.name}
        badge={<StatusBadge kind="tenant" status={active.status} />}
        description="Your products, what they cost, and how they are doing."
        actions={
          canBuy ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/products">Add a product</Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active products" value={live.length} icon={Package} href={TENANT.billing} sub={mrrCents > 0 ? `${formatCents(mrrCents)}/mo` : "no recurring charges"} />
        <StatTile
          label="Open balance"
          value={formatCents(openCents)}
          icon={Receipt}
          tone={openCents > 0 ? "warning" : "success"}
          sub={openCents > 0 ? "awaiting payment" : "all settled"}
          href={TENANT.billing}
        />
        <StatTile
          label="Site health"
          value={live.length === 0 ? "—" : down ? `${down} need attention` : "Healthy"}
          icon={Activity}
          tone={down ? "danger" : live.length ? "success" : "default"}
          href={TENANT.monitoring}
          sub={nextRenewal ? `next renewal ${formatDate(nextRenewal)}` : undefined}
        />
        <StatTile label="Team members" value={members.length} icon={Users} href={TENANT.team} />
      </div>

      <Section title="Your products" count={live.length}>
        {live.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No active products"
            description="Everything you subscribe to shows up here with its status and renewal."
            action={
              canBuy ? (
                <Button asChild size="sm">
                  <Link href="/products">Browse the catalog</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {live.map((s) => {
              const h = health.get(s.id);
              return (
                <Link key={s.id} href={TENANT.billing} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/50">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.productColor ?? "var(--primary)" }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-heading">{s.productName}</span>
                      <StatusBadge kind="subscription" status={s.status} />
                      {h && <StatusBadge kind="health" status={h.status} className="text-[10px]" />}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {s.monthlyCents > 0 ? `${formatCents(s.monthlyCents)}/mo` : "no recurring charge"}
                      {s.currentPeriodEnd ? ` · renews ${formatDate(s.currentPeriodEnd)}` : ""}
                      {s.domainUrl ? ` · ${s.domainUrl}` : ""}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
