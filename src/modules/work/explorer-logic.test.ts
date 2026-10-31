import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPLORER,
  activeFilterCount,
  explorerColumns,
  explorerQuery,
  groupLanes,
  isOverdue,
  parseExplorerFilters,
  parseItemRef,
  sortCards,
  type ExplorerCard,
} from "./explorer-logic";

const fix = { id: "p1", slug: "fixorata", name: "Fixorata", color: "#f00", icon: null };
const prop = { id: "p2", slug: "proporata", name: "PropOrata", color: null, icon: null };

const card = (o: Partial<ExplorerCard> & { id: string }): ExplorerCard => ({
  number: 1,
  key: "FIX-1",
  type: "task",
  title: o.id,
  status: "todo",
  priority: "medium",
  rank: "n",
  estimatePoints: null,
  assignee: null,
  sprintId: null,
  source: "internal",
  labels: [],
  dueOn: null,
  commentCount: 0,
  flag: null,
  resolution: null,
  epic: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  product: fix,
  ...o,
});

describe("parseExplorerFilters", () => {
  it("defaults to the plain board", () => {
    expect(parseExplorerFilters({})).toEqual({ ...DEFAULT_EXPLORER, q: undefined, item: undefined });
  });

  it("reads comma lists and drops junk values", () => {
    const f = parseExplorerFilters({
      product: "fixorata,proporata,fixorata",
      status: "todo,nope,done",
      priority: ["high,urgent", "low"],
      assignee: "me,unassigned,<script>",
      label: "UI,auth",
      epic: "ep1,none",
      quick: "mine,whatever",
      view: "list",
      group: "client",
      sort: "due",
      dir: "desc",
      item: "fixorata~12",
    });
    expect(f.product).toEqual(["fixorata", "proporata"]);
    expect(f.status).toEqual(["todo", "done"]);
    expect(f.priority).toEqual(["high", "urgent"]);
    expect(f.assignee).toEqual(["me", "unassigned"]);
    expect(f.label).toEqual(["ui", "auth"]);
    expect(f.epic).toEqual(["ep1", "none"]);
    expect(f.quick).toEqual(["mine"]);
    expect([f.view, f.group, f.sort, f.dir, f.item]).toEqual(["list", "client", "due", "desc", "fixorata~12"]);
  });

  it("falls back on unknown view, group, sort and item refs", () => {
    const f = parseExplorerFilters({ view: "gantt", group: "mood", sort: "vibes", item: "../etc~x" });
    expect([f.view, f.group, f.sort, f.item]).toEqual(["board", "none", "rank", undefined]);
  });

  it("round-trips through explorerQuery, dropping defaults", () => {
    const f = parseExplorerFilters({ product: "fixorata", group: "assignee", q: " login " });
    expect(explorerQuery(f)).toEqual(expect.objectContaining({ product: "fixorata", group: "assignee", q: "login", view: undefined, sort: undefined }));
    expect(parseExplorerFilters(explorerQuery(f) as Record<string, string>)).toEqual(f);
  });
});

describe("helpers", () => {
  it("counts narrowing filters only", () => {
    expect(activeFilterCount({ ...DEFAULT_EXPLORER, view: "list", group: "product", item: "x~1" })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_EXPLORER, q: "x", product: ["a", "b"], quick: ["mine"] })).toBe(4);
  });

  it("parses item refs", () => {
    expect(parseItemRef("marketing-hs-growth~7")).toEqual({ slug: "marketing-hs-growth", number: 7 });
    expect(parseItemRef("fixorata~0")).toBeNull();
    expect(parseItemRef(undefined)).toBeNull();
  });

  it("picks columns from the status filter, else Backlog through Done", () => {
    expect(explorerColumns({ status: [] })).toEqual(["backlog", "todo", "in_progress", "in_review", "done"]);
    expect(explorerColumns({ status: [] }, { backlog: false })).toEqual(["todo", "in_progress", "in_review", "done"]);
    expect(explorerColumns({ status: ["done", "todo"] })).toEqual(["todo", "done"]);
  });

  it("flags overdue open items only", () => {
    expect(isOverdue({ dueOn: "2026-10-01", status: "todo" }, "2026-10-31")).toBe(true);
    expect(isOverdue({ dueOn: "2026-10-31", status: "todo" }, "2026-10-31")).toBe(false);
    expect(isOverdue({ dueOn: "2026-10-01", status: "done" }, "2026-10-31")).toBe(false);
    expect(isOverdue({ dueOn: null, status: "todo" }, "2026-10-31")).toBe(false);
  });
});

describe("groupLanes", () => {
  const ada = { id: "u-ada", name: "Ada" };
  const bob = { id: "u-bob", name: "Bob" };
  const cards = [
    card({ id: "a", assignee: bob, priority: "low", product: prop }),
    card({ id: "b", assignee: null, priority: "urgent", requester: { tenantId: "t1", tenantName: "ACME" } }),
    card({ id: "c", assignee: ada, priority: "low", requester: null }),
    card({ id: "d", assignee: bob, priority: "high" }),
  ];

  it("one lane when ungrouped", () => {
    expect(groupLanes(cards, "none").map((l) => l.cards.length)).toEqual([4]);
  });

  it("assignee lanes: viewer first, unassigned last, lane defaults set", () => {
    const lanes = groupLanes(cards, "assignee", { viewerId: "u-bob" });
    expect(lanes.map((l) => l.label)).toEqual(["Bob", "Ada", "Unassigned"]);
    expect(lanes[0].cards.map((c) => c.id)).toEqual(["a", "d"]);
    expect(lanes[2].defaults).toEqual({ assigneeUserId: null });
  });

  it("priority lanes in priority order", () => {
    expect(groupLanes(cards, "priority").map((l) => l.defaults.priority)).toEqual(["urgent", "high", "low"]);
  });

  it("product lanes follow catalog order", () => {
    const lanes = groupLanes(cards, "product", { productOrder: ["proporata", "fixorata"] });
    expect(lanes.map((l) => l.defaults.productSlug)).toEqual(["proporata", "fixorata"]);
  });

  it("epic lanes create into the epic's company and parent; no-epic lane last", () => {
    const epic = { id: "ep1", key: "PROP-9", title: "Resident portal" };
    const lanes = groupLanes([card({ id: "x" }), card({ id: "y", epic, product: prop })], "epic");
    expect(lanes.map((l) => l.label)).toEqual(["PROP-9 Resident portal", "No epic"]);
    expect(lanes[0].defaults).toEqual({ parentId: "ep1", productSlug: "proporata" });
  });

  it("client lanes: cards without a visible requester share 'No client'", () => {
    const lanes = groupLanes(cards, "client");
    expect(lanes.map((l) => [l.label, l.cards.length])).toEqual([["ACME", 1], ["No client", 3]]);
  });
});

describe("sortCards", () => {
  const cards = [
    card({ id: "a", key: "FIX-10", priority: "low", dueOn: null, updatedAt: "2026-10-03T00:00:00.000Z" }),
    card({ id: "b", key: "FIX-2", priority: "urgent", dueOn: "2026-11-02", updatedAt: "2026-10-01T00:00:00.000Z" }),
    card({ id: "c", key: "FIX-3", priority: "high", dueOn: "2026-11-01", updatedAt: "2026-10-02T00:00:00.000Z" }),
  ];
  const ids = (xs: ExplorerCard[]) => xs.map((c) => c.id);

  it("sorts keys numerically", () => expect(ids(sortCards(cards, "key", "asc"))).toEqual(["b", "c", "a"]));
  it("sorts by priority", () => expect(ids(sortCards(cards, "priority", "asc"))).toEqual(["b", "c", "a"]));
  it("newest update first when descending", () => expect(ids(sortCards(cards, "updated", "desc"))).toEqual(["a", "c", "b"]));
  it("undated items sort last in both directions", () => {
    expect(ids(sortCards(cards, "due", "asc"))).toEqual(["c", "b", "a"]);
    expect(ids(sortCards(cards, "due", "desc"))).toEqual(["b", "c", "a"]);
  });
});
