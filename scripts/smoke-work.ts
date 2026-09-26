/**
 * Work-management smoke (local DB). Boards, numbering, ranks, sprints,
 * comments, and — the security-relevant part — that a developer viewer's
 * payloads carry no client reference. Creates its own product + users and
 * removes them at the end. Run:
 *   node --env-file=.env --import tsx scripts/smoke-work.ts
 */
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db";
import { organization, user } from "../src/modules/auth/schema";
import { products } from "../src/modules/catalog/schema";
import { auditLogs } from "../src/modules/audit/schema";
import { createStaffAccount } from "../src/modules/access/service";
import * as svc from "../src/modules/work/service";
import * as q from "../src/modules/work/queries";
import { workBoards, workItems, workSprints } from "../src/modules/work/schema";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
const noClient = (payload: unknown, orgId: string, orgName: string, what: string) => {
  const s = JSON.stringify(payload);
  assert(!s.includes(orgId) && !s.includes(orgName) && !s.includes('"requester"'), `${what}: developer payload names a client`);
};

async function main() {
  const stamp = Date.now();
  const now = new Date();
  const opsId = `ops_${stamp}`;
  const devId = `dev_${stamp}`;
  const orgId = `org_${stamp}`;
  const orgName = `Smoke Client ${stamp}`;
  await db.insert(user).values([
    { id: opsId, name: "Ops Smoke", email: `${opsId}@example.com`, emailVerified: true, firstName: "Ops", lastName: "Smoke", phone: "+15550007777", platformRole: "ops_admin", createdAt: now, updatedAt: now },
    { id: devId, name: "Dev Smoke", email: `${devId}@example.com`, emailVerified: true, firstName: "Dev", lastName: "Smoke", phone: "+15550007778", platformRole: "developer", createdAt: now, updatedAt: now },
  ]);
  await db.insert(organization).values({ id: orgId, name: orgName, slug: `smoke-${stamp}`, createdAt: now, status: "active" });
  const [product] = await db
    .insert(products)
    .values({ slug: `smoke-work-${stamp}`, name: "Smoke Work Product", category: "Smoke", description: "smoke", isActive: true, sortOrder: 999 })
    .returning();
  const ops = { userId: opsId, isOps: true, tenantIds: [] as string[] };
  const dev = { userId: devId, isOps: false, tenantIds: [] as string[] };
  let devAccountId: string | null = null;

  try {
    console.log("1) board is created lazily with a prefix from the slug…");
    const board = await q.getBoardBySlug(product.slug);
    assert(board && board.keyPrefix.length >= 2 && board.mode === "kanban", "board created");
    assert((await q.getBoardBySlug(product.slug))!.id === board.id, "second read reuses the board");

    console.log("2) items number sequentially; ops may name a requester, developers may not…");
    const a = await svc.createItem({ boardId: board.id, title: "Login fails on Safari", description: "", type: "bug", priority: "high", status: "todo", labels: ["auth"], source: "client_request", reporterUserId: opsId, requesterTenantId: orgId });
    const b = await svc.createItem({ boardId: board.id, title: "Dark mode", description: "", type: "feature", priority: "medium", status: "backlog", labels: [], source: "internal", reporterUserId: devId });
    const c = await svc.createItem({ boardId: board.id, title: "Refactor", description: "", type: "task", priority: "low", status: "todo", labels: [], source: "internal", reporterUserId: devId });
    assert(a.number === 1 && b.number === 2 && c.number === 3, `numbers 1,2,3 (got ${a.number},${b.number},${c.number})`);
    assert(a.key === `${board.keyPrefix}-1`, "key format");

    console.log("3) developer payloads carry no client reference; ops payloads do…");
    const devView = await q.getBoardView(board.id, dev);
    noClient(devView, orgId, orgName, "board view");
    const opsView = await q.getBoardView(board.id, ops);
    const opsCard = opsView!.columns.find((col) => col.status === "todo")!.cards.find((x) => x.id === a.id)!;
    assert(opsCard.requester?.tenantId === orgId, "ops sees the requester");
    const devItem = await q.getItem(board.id, a.number, dev);
    noClient(devItem, orgId, orgName, "item detail");
    assert(devItem!.events.every((e) => e.kind !== "requester_changed"), "requester event hidden from developers");
    const opsItem = await q.getItem(board.id, a.number, ops);
    assert(opsItem!.events.some((e) => e.kind === "requester_changed"), "ops sees the requester event");
    noClient(await q.getBacklogView(board.id, dev), orgId, orgName, "backlog view");
    noClient(await q.listMyWork(dev), orgId, orgName, "my work");
    const tenantItems = await q.listItemsForTenant(orgId);
    assert(tenantItems.length === 1 && tenantItems[0].id === a.id, "client overview lists its request");

    console.log("4) moves rank cards within and across columns…");
    const m1 = await svc.moveItem({ itemId: c.id, status: "todo", prevId: null, nextId: a.id, actorUserId: devId });
    const todo = (await q.getBoardView(board.id, dev))!.columns.find((col) => col.status === "todo")!.cards;
    assert(todo.map((x) => x.id).join() === [c.id, a.id].join(), "c dropped before a");
    assert(m1.rank < opsCard.rank, "rank sorts before");
    let prev = c.id;
    let last = "";
    for (let i = 0; i < 40; i++) {
      const n = await svc.createItem({ boardId: board.id, title: `filler ${i}`, description: "", type: "task", priority: "medium", status: "todo", labels: [], source: "internal", reporterUserId: devId });
      const r = await svc.moveItem({ itemId: n.id, status: "todo", prevId: prev, nextId: a.id, actorUserId: devId });
      assert(last === "" || r.rank > last, "repeated insertion keeps increasing");
      last = r.rank;
      prev = n.id;
    }
    const col = await db.select({ rank: workItems.rank }).from(workItems).where(eq(workItems.boardId, board.id));
    assert(col.every((x) => x.rank.length <= 40), "ranks stay short (rebalance kicks in)");
    const moved = await svc.moveItem({ itemId: a.id, status: "in_progress", actorUserId: devId });
    assert(moved.status === "in_progress", "status changed");
    const aRow = await db.query.workItems.findFirst({ where: eq(workItems.id, a.id) });
    assert(aRow?.startedAt, "startedAt stamped");

    console.log("5) sprints: settings, plan, start (only one active), complete with carry-over…");
    await svc.updateBoardSettings({ boardId: board.id, keyPrefix: board.keyPrefix, mode: "sprints", sprintLengthDays: 7, wipLimits: { in_progress: 2 }, actorUserId: opsId });
    const s1 = await svc.createSprint({ boardId: board.id, actorUserId: devId });
    const s1row = (await db.query.workSprints.findFirst({ where: eq(workSprints.id, s1.sprintId) }))!;
    assert(s1row.name === "Sprint 1" && s1row.endsOn > s1row.startsOn, "default name + 7-day window");
    await svc.setItemSprint({ itemId: b.id, sprintId: s1.sprintId, actorUserId: devId });
    assert((await db.query.workItems.findFirst({ where: eq(workItems.id, b.id) }))!.status === "todo", "backlog item planned into a sprint becomes to do");
    await svc.setItemSprint({ itemId: a.id, sprintId: s1.sprintId, actorUserId: devId });
    await svc.startSprint({ sprintId: s1.sprintId, actorUserId: devId });
    const s2 = await svc.createSprint({ boardId: board.id, actorUserId: devId });
    let clash = "";
    try {
      await svc.startSprint({ sprintId: s2.sprintId, actorUserId: devId });
    } catch (e) {
      clash = (e as Error).message;
    }
    assert(/already active/.test(clash), `second start refused (${clash})`);
    let refused = "";
    try {
      await svc.updateBoardSettings({ boardId: board.id, keyPrefix: board.keyPrefix, mode: "kanban", sprintLengthDays: 7, wipLimits: {}, actorUserId: opsId });
    } catch (e) {
      refused = (e as Error).message;
    }
    assert(/active sprint/.test(refused), "kanban switch refused while a sprint is active");
    await svc.moveItem({ itemId: b.id, status: "done", actorUserId: devId });
    const done = await svc.completeSprint({ sprintId: s1.sprintId, carryOver: "next", actorUserId: devId });
    assert(done.nextSprintId === s2.sprintId && done.carried === 1 && done.completedCount === 1, `carry-over to the planned sprint (${JSON.stringify(done)})`);
    const report = await q.getSprintReport(s1.sprintId, dev);
    assert(report!.done.length === 1 && report!.carriedOut.length === 1 && report!.carriedOut[0].id === a.id, "report shows done + carried");
    noClient(report, orgId, orgName, "sprint report");
    assert((await db.query.workItems.findFirst({ where: eq(workItems.id, a.id) }))!.sprintId === s2.sprintId, "carried item is on the next sprint");
    const overview = await q.listBoardsOverview(dev);
    assert(overview.some((r) => r.product.id === product.id && r.board?.mode === "sprints"), "overview lists the board");

    console.log("6) comments: author or ops only…");
    const cm = await svc.addComment({ itemId: a.id, body: "looking", authorUserId: devId });
    let denied = "";
    try {
      await svc.editComment({ commentId: cm.commentId, body: "x", actorUserId: `stranger_${stamp}`, actorIsOps: false });
    } catch (e) {
      denied = (e as Error).message;
    }
    assert(/author or ops/.test(denied), "stranger cannot edit");
    await svc.editComment({ commentId: cm.commentId, body: "looking now", actorUserId: opsId, actorIsOps: true });
    await svc.deleteComment({ commentId: cm.commentId, actorUserId: devId, actorIsOps: false });
    assert((await q.getItem(board.id, a.number, dev))!.comments.length === 0, "comment deleted");

    console.log("7) ops creates a developer account (audited, mail logged)…");
    const created = await createStaffAccount({ email: `NewDev_${stamp}@Example.com`, firstName: "New", lastName: "Dev", role: "developer", actorUserId: opsId });
    devAccountId = created.userId;
    const nd = await db.query.user.findFirst({ where: eq(user.id, created.userId) });
    assert(nd?.platformRole === "developer" && nd.emailVerified && nd.email === `newdev_${stamp}@example.com`, "developer row");
    const audits = await db.select({ kind: auditLogs.kind }).from(auditLogs).where(eq(auditLogs.actorUserId, opsId));
    assert(audits.some((x) => x.kind === "platform_role_changed") && audits.some((x) => x.kind === "platform_account_created"), "audit rows");
    const assignees = await q.listWorkAssignees();
    assert(assignees.some((x) => x.id === created.userId) && assignees.some((x) => x.id === opsId), "assignees = developers + ops");

    console.log("8) delete cascades…");
    await svc.deleteItem({ itemId: c.id, actorUserId: opsId });
    assert((await q.getItem(board.id, c.number, ops)) === null, "item gone");
    console.log("\nOK — work smoke passed");
  } finally {
    await db.delete(products).where(eq(products.id, product.id)); // cascades board → items → comments/events
    await db.delete(workBoards).where(eq(workBoards.productId, product.id));
    await db.delete(organization).where(eq(organization.id, orgId));
    await db.delete(auditLogs).where(eq(auditLogs.actorUserId, opsId));
    await db.delete(user).where(inArray(user.id, [opsId, devId, ...(devAccountId ? [devAccountId] : [])]));
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
