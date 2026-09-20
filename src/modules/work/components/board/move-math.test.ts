import { describe, expect, it } from "vitest";
import type { WorkCardDto } from "../../dto";
import { dropTarget, neighboursFor, reduceMove, type ColumnMap } from "./move-math";

const card = (id: string, status: WorkCardDto["status"]): WorkCardDto => ({
  id, number: 1, key: `K-${id}`, type: "task", title: id, status, priority: "medium", rank: "n", estimatePoints: null,
  assignee: null, sprintId: null, source: "internal", labels: [], dueOn: null, commentCount: 0, createdAt: "", updatedAt: "",
});
const cols = (): ColumnMap => ({
  todo: [card("a", "todo"), card("b", "todo"), card("c", "todo")],
  in_progress: [card("d", "in_progress")],
  in_review: [],
});
const ids = (cs: WorkCardDto[]) => cs.map((c) => c.id);

describe("reduceMove", () => {
  it("moves a card to another column at an index and updates its status", () => {
    const r = reduceMove(cols(), { itemId: "b", to: "in_progress", index: 0 });
    expect(ids(r.todo)).toEqual(["a", "c"]);
    expect(ids(r.in_progress)).toEqual(["b", "d"]);
    expect(r.in_progress[0].status).toBe("in_progress");
  });
  it("reorders within a column and clamps the index", () => {
    expect(ids(reduceMove(cols(), { itemId: "a", to: "todo", index: 2 }).todo)).toEqual(["b", "c", "a"]);
    expect(ids(reduceMove(cols(), { itemId: "a", to: "in_review", index: 9 }).in_review)).toEqual(["a"]);
  });
  it("ignores unknown cards", () => {
    expect(reduceMove(cols(), { itemId: "zzz", to: "todo", index: 0 })).toEqual(cols());
  });
});

describe("neighboursFor", () => {
  const t = cols().todo;
  it("names the cards on either side", () => {
    expect(neighboursFor(t, 0)).toEqual({ prevId: undefined, nextId: "a" });
    expect(neighboursFor(t, 1)).toEqual({ prevId: "a", nextId: "b" });
    expect(neighboursFor(t, 3)).toEqual({ prevId: "c", nextId: undefined });
  });
});

describe("dropTarget", () => {
  it("appends when dropped on a column", () => {
    expect(dropTarget({ activeId: "a", overId: "col", overColumn: "in_progress", cols: cols(), below: false })).toEqual({ to: "in_progress", index: 1, prevId: "d", nextId: undefined });
    expect(dropTarget({ activeId: "a", overId: "col", overColumn: "in_review", cols: cols(), below: false })).toEqual({ to: "in_review", index: 0, prevId: undefined, nextId: undefined });
  });
  it("lands before or after the over-card by pointer position", () => {
    expect(dropTarget({ activeId: "a", overId: "d", overColumn: null, cols: cols(), below: false })).toEqual({ to: "in_progress", index: 0, prevId: undefined, nextId: "d" });
    expect(dropTarget({ activeId: "a", overId: "d", overColumn: null, cols: cols(), below: true })).toEqual({ to: "in_progress", index: 1, prevId: "d", nextId: undefined });
  });
  it("reorders within a column and treats a no-op as null", () => {
    expect(dropTarget({ activeId: "a", overId: "c", overColumn: null, cols: cols(), below: true })).toEqual({ to: "todo", index: 2, prevId: "c", nextId: undefined });
    expect(dropTarget({ activeId: "c", overId: "a", overColumn: null, cols: cols(), below: false })).toEqual({ to: "todo", index: 0, prevId: undefined, nextId: "a" });
    expect(dropTarget({ activeId: "a", overId: "b", overColumn: null, cols: cols(), below: false })).toBeNull();
    expect(dropTarget({ activeId: "a", overId: "col", overColumn: "todo", cols: cols(), below: false })).toEqual({ to: "todo", index: 2, prevId: "c", nextId: undefined });
    expect(dropTarget({ activeId: "c", overId: "col", overColumn: "todo", cols: cols(), below: false })).toBeNull();
  });
  it("ignores drops on itself or unknown ids", () => {
    expect(dropTarget({ activeId: "a", overId: "a", overColumn: null, cols: cols(), below: false })).toBeNull();
    expect(dropTarget({ activeId: "zzz", overId: "a", overColumn: null, cols: cols(), below: false })).toBeNull();
  });
});
