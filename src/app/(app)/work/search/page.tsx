import { impersonationOf, isOps, isOpsAdmin, requireWorkPage, workViewer } from "@/policy";
import { listAllTenants } from "@/modules/tenancy/queries";
import { getBoardBySlug, getItem, jqlSuggestData, listWorkAssignees, searchWorkByJql } from "@/modules/work/queries";
import { DEFAULT_EXPLORER, parseItemRef } from "@/modules/work/explorer-logic";
import { jqlSortState, parseJql } from "@/modules/work/jql-logic";
import { ExplorerList } from "@/modules/work/components/explorer/explorer-list";
import { ItemPeek } from "@/modules/work/components/item/item-peek";
import { JqlBar } from "@/modules/work/components/jql/jql-bar";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Search · Work" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** No query: open work across every board, newest first (Jira's default search). */
const DEFAULT_JQL = "status not in (Done, Canceled) ORDER BY updated DESC";

/** Jira's advanced search: JQL across every board, results as the list view, quick view on the side. */
export default async function WorkSearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireWorkPage();
  const viewer = await workViewer(session);
  const ops = isOps(session);
  const sp = await searchParams;
  const jql = (first(sp.jql) ?? DEFAULT_JQL).slice(0, 4000);
  const ref = parseItemRef(first(sp.item));

  const [result, suggest, assignees, tenants, peekBoard] = await Promise.all([
    searchWorkByJql(jql, viewer),
    jqlSuggestData(viewer),
    listWorkAssignees(),
    ops ? listAllTenants() : Promise.resolve([]),
    ref ? getBoardBySlug(ref.slug) : Promise.resolve(null),
  ]);
  const peekItem = peekBoard && ref ? await getItem(peekBoard.id, ref.number, viewer) : null;
  let parsed = null;
  try {
    parsed = parseJql(jql, { ops });
  } catch {
    // The error is already in `result`.
  }
  const tenantOptions = tenants.map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className="group flex flex-col gap-4">
      <PageHeader title="Search work items" description="Jira-style JQL across every board. Start typing for fields, values and keywords." />
      <JqlBar initial={jql} error={result.ok ? null : { message: result.error, pos: result.pos }} dyn={{ ...suggest, ops }} />
      {result.ok && (
        <>
          <div className="text-sm text-muted-foreground" aria-live="polite">
            {result.total === 1 ? "1 item" : `${result.total} items`}
            {result.truncated && " — showing the first 500; narrow the query to see the rest"}
          </div>
          <ExplorerList cards={result.items} filters={{ ...DEFAULT_EXPLORER, view: "list", ...jqlSortState(parsed) }} assignees={assignees} productOrder={[]} jql={jql} />
        </>
      )}
      <ItemPeek
        item={peekItem}
        product={peekBoard?.product ?? null}
        mode={peekBoard?.mode ?? "kanban"}
        canManage={isOpsAdmin(session) && !impersonationOf(session)}
        canLinkClient={ops}
        tenants={tenantOptions}
        viewer={{ id: session.user.id, name: session.user.name }}
      />
    </div>
  );
}
