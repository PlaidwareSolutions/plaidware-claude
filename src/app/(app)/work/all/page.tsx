import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { WORK } from "@/lib/routes";
import { impersonationOf, isOps, isOpsAdmin, requireWorkPage, workViewer } from "@/policy";
import { listAllTenants } from "@/modules/tenancy/queries";
import { getBoardBySlug, getExplorerView, getItem, resolveMovedItem } from "@/modules/work/queries";
import { parseExplorerFilters, parseItemRef } from "@/modules/work/explorer-logic";
import { ProjectScopePicker } from "@/modules/work/components/explorer/project-scope-picker";
import { ExplorerToolbar } from "@/modules/work/components/explorer/explorer-toolbar";
import { ExplorerBoard } from "@/modules/work/components/explorer/explorer-board";
import { ExplorerList } from "@/modules/work/components/explorer/explorer-list";
import { ItemPeek } from "@/modules/work/components/item/item-peek";
import { NewItemDialog } from "@/modules/work/components/new-item-dialog";
import { AllWorkTabs } from "@/modules/work/components/work-tabs";
import { BoardHeaderActions, BoardTitleMenu } from "@/modules/work/components/board-header-actions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "All work" };
export const dynamic = "force-dynamic";

/** The cross-company board, laid out like a Jira board (breadcrumb scope, title, icon row, tabs, toolbar). */
export default async function AllWorkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireWorkPage();
  const viewer = await workViewer(session);
  const ops = isOps(session);
  const filters = parseExplorerFilters(await searchParams);
  const ref = parseItemRef(filters.item);

  const [view, tenants, peekBoard] = await Promise.all([
    getExplorerView(viewer, filters),
    ops ? listAllTenants() : Promise.resolve([]),
    ref ? getBoardBySlug(ref.slug) : Promise.resolve(null),
  ]);
  const peekItem = peekBoard && ref ? await getItem(peekBoard.id, ref.number, viewer) : null;
  if (ref && !peekItem) {
    const moved = await resolveMovedItem(ref.slug, ref.number);
    if (moved) redirect(WORK.item(moved.slug, moved.number));
  }
  const tenantOptions = tenants.map((t) => ({ id: t.id, name: t.name }));
  const productOrder = view.products.map((p) => p.slug);

  return (
    <div className="group flex flex-col gap-4">
      <PageHeader
        crumbs={<ProjectScopePicker products={view.products} selected={filters.product} />}
        title="All work board"
        badge={<BoardTitleMenu />}
        actions={
          <>
            <NewItemDialog
              trigger={
                <Button size="sm" className="h-8 gap-1.5 rounded-[3px] bg-info font-semibold text-white hover:bg-info/90 dark:text-background">
                  <Plus className="size-4" /> Create
                </Button>
              }
              boards={view.products.map((p) => ({ boardId: p.boardId, slug: p.slug, name: p.name, color: p.color }))}
              defaultBoardSlug={filters.product.length === 1 ? filters.product[0] : undefined}
              defaultStatus="todo"
              assignees={view.assignees}
              epics={view.epics}
              canLinkClient={ops}
              tenants={tenantOptions}
              hotkey
            />
            <BoardHeaderActions label="this board" />
          </>
        }
      >
        <AllWorkTabs />
      </PageHeader>
      <ExplorerToolbar filters={filters} clients={view.clients} assignees={view.assignees} labels={view.labels} epics={view.epics} viewerId={viewer.userId} />
      {filters.view === "list" ? (
        <ExplorerList cards={view.cards} filters={filters} assignees={view.assignees} productOrder={productOrder} />
      ) : (
        <ExplorerBoard
          cards={view.cards}
          filters={filters}
          products={view.products}
          assignees={view.assignees}
          viewerId={viewer.userId}
          canLinkClient={ops}
          doneWindowDays={view.doneWindowDays}
        />
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
