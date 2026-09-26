import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Package, SquareKanban, Users } from "lucide-react";
import { TypeIcon } from "@/modules/work/components/item-bits";
import { SOURCE_LABELS } from "@/modules/work/components/labels";
import { OPEN_STATUSES } from "@/modules/work/transitions";
import { WORK } from "@/lib/routes";
import { formatDate, formatRelative } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { loadWorkClient } from "./load";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const client = await loadWorkClient(id);
  return { title: client ? `${client.name} · Clients` : "Client" };
}

/** One client, as a member developer may see it: what they run, who they are, what they asked for. No billing, no monitoring. */
export default async function WorkClientPage({ params }: { params: Params }) {
  const { id } = await params;
  const client = await loadWorkClient(id);
  if (!client) notFound();
  const open = client.items.filter((i) => (OPEN_STATUSES as readonly string[]).includes(i.status));
  const closed = client.items.length - open.length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: WORK.clients, label: "Clients" }}
        title={client.name}
        badge={<StatusBadge kind="tenant" status={client.status} />}
        meta={`${client.slug} · on the workspace since ${formatDate(client.joinedAt)} · read-only`}
      />

      <Section title="Products" icon={Package} count={client.products.length} description="what the client runs and where">
        {client.products.length === 0 ? (
          <EmptyState compact title="No live products" description="Nothing is subscribed right now." />
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {client.products.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color ?? "var(--primary)" }} />
                <Link href={WORK.board(p.slug)} className="font-medium text-heading hover:text-primary">
                  {p.name}
                </Link>
                <StatusBadge kind="subscription" status={p.status} className="text-[10px]" />
                {p.domainUrl ? (
                  <a
                    href={p.domainUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {p.domainUrl.replace(/^https?:\/\//, "")} <ExternalLink className="size-3" />
                  </a>
                ) : (
                  <span className="ml-auto text-xs text-muted-foreground">no live domain yet</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Requests" icon={SquareKanban} count={open.length} description="work items this client asked for">
        {client.items.length === 0 ? (
          <EmptyState compact title="Nothing linked to this client yet" description="Ops link items from the Requesting client field; they show up here." />
        ) : (
          <div className="flex flex-col gap-2">
            <ol className="divide-y rounded-lg border bg-card">
              {open.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <TypeIcon type={r.type} />
                  <Link href={WORK.item(r.product.slug, r.number)} className="font-mono text-xs text-muted-foreground hover:text-primary">
                    {r.key}
                  </Link>
                  <Link href={WORK.item(r.product.slug, r.number)} className="min-w-0 flex-1 truncate font-medium text-heading hover:text-primary">
                    {r.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">{r.product.name}</span>
                  <StatusBadge kind="workItem" status={r.status} className="text-[10px]" />
                  <StatusBadge kind="workPriority" status={r.priority} className="text-[10px]" />
                  {r.assignee && <span className="text-xs text-muted-foreground">{r.assignee.name}</span>}
                  <span className="text-xs text-muted-foreground">
                    {SOURCE_LABELS[r.source]} · {formatRelative(r.updatedAt)}
                  </span>
                </li>
              ))}
            </ol>
            {(closed > 0 || open.length === 0) && (
              <p className="text-xs text-muted-foreground">
                {open.length === 0 ? "Nothing open · " : ""}
                {closed} done or canceled
              </p>
            )}
          </div>
        )}
      </Section>

      <Section title="People" icon={Users} count={client.people.length} description="who's on the workspace">
        <ul className="divide-y rounded-lg border bg-card">
          {client.people.map((p) => (
            <li key={p.userId} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-medium text-heading">
                {p.name}
                {p.isViewer && <span className="text-muted-foreground"> (you)</span>}
              </span>
              <span className="text-xs text-muted-foreground">{p.email}</span>
              <StatusBadge kind="tenantRole" status={p.role} className="ml-auto text-[10px]" />
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
