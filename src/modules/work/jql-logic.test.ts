import { describe, expect, it } from "vitest";
import { DEFAULT_EXPLORER } from "./explorer-logic";
import { filtersToJql, JqlError, jqlSuggest, withOrderBy, normalizeEnum, parseJql, parseKey, resolveDate, resolveField, tokenize } from "./jql-logic";

const NOW = new Date("2026-11-04T15:30:00Z"); // a Wednesday

describe("parseJql", () => {
  it("parses clauses, precedence and ORDER BY", () => {
    const q = parseJql('project = FIXO AND status in ("To do", "In progress") OR assignee = currentUser() ORDER BY priority DESC, updated');
    expect(q.orderBy).toEqual([{ field: "priority", dir: "desc" }, { field: "updated", dir: "asc" }]);
    // AND binds tighter than OR.
    expect(q.where?.kind).toBe("or");
    const or = q.where as Extract<NonNullable<typeof q.where>, { kind: "or" }>;
    expect(or.left.kind).toBe("and");
    expect(or.right).toMatchObject({ kind: "cmp", field: "assignee", op: "=", values: [{ kind: "fn", name: "currentuser" }] });
  });

  it("handles NOT, parentheses, NOT IN, IS EMPTY and aliases", () => {
    const q = parseJql("NOT (issuetype = Bug OR labels is EMPTY) AND priority not in (Low, Medium) AND assignee IS NOT EMPTY");
    expect(q.where?.kind).toBe("and");
    expect(JSON.stringify(q.where)).toContain('"field":"type"');
    expect(JSON.stringify(q.where)).toContain('"op":"not in"');
    expect(JSON.stringify(q.where)).toContain('"op":"is not"');
  });

  it("accepts an ORDER BY alone and an empty query", () => {
    expect(parseJql("order by created desc")).toEqual({ where: null, orderBy: [{ field: "created", dir: "desc" }] });
    expect(parseJql("")).toEqual({ where: null, orderBy: [] });
  });

  it("explains mistakes with a position", () => {
    const err = (s: string) => {
      try {
        parseJql(s);
      } catch (e) {
        return e as JqlError;
      }
      throw new Error("expected an error");
    };
    expect(err("colour = red").message).toMatch(/Unknown field "colour"/);
    expect(err("summary = refund").message).toMatch(/doesn't support "="/);
    expect(err("status = Done status = Backlog").message).toMatch(/join clauses with AND or OR/);
    expect(err('summary ~ "open').message).toMatch(/isn't closed/);
    expect(err("status in ()").message).toMatch(/empty list/);
    expect(err("status in (Done").message).toMatch(/isn't closed/);
    expect(err("(status = Done").message).toMatch(/isn't closed/);
    expect(err("order by summary2").message).toMatch(/Can't order by/);
    expect(err("summary = x").pos).toBe(8);
  });

  it("keeps the client field to ops", () => {
    expect(() => parseJql("client = Acme", { ops: false })).toThrow(/only available to ops/);
    expect(parseJql("client = Acme", { ops: true }).where).toMatchObject({ field: "client" });
  });
});

describe("values", () => {
  it("normalises Jira's words for our enums", () => {
    expect(normalizeEnum("status", "In Progress")).toBe("in_progress");
    expect(normalizeEnum("status", "to-do")).toBe("todo");
    expect(normalizeEnum("status", "Cancelled")).toBe("canceled");
    expect(normalizeEnum("priority", "Highest")).toBe("urgent");
    expect(normalizeEnum("type", "Story")).toBe("feature");
    expect(normalizeEnum("resolution", "Won't Do")).toBe("wont_do");
    expect(normalizeEnum("status", "Nope")).toBeNull();
  });

  it("resolves absolute, relative and function dates", () => {
    const d = (v: string) => resolveDate({ kind: "lit", v, quoted: false, pos: 0 }, NOW)!.toISOString();
    expect(d("2026-11-01")).toBe("2026-11-01T00:00:00.000Z");
    expect(d("-7d")).toBe("2026-10-28T15:30:00.000Z");
    expect(d("2w")).toBe("2026-11-18T15:30:00.000Z");
    const f = (name: string, args: string[] = []) => resolveDate({ kind: "fn", name, args, pos: 0 }, NOW)!.toISOString();
    expect(f("startofday")).toBe("2026-11-04T00:00:00.000Z");
    expect(f("startofweek")).toBe("2026-11-02T00:00:00.000Z");
    expect(f("startofmonth", ["-1"])).toBe("2026-10-01T00:00:00.000Z");
    expect(() => d("yesterday")).toThrow(/isn't a date/);
  });

  it("parses keys and tokenizes keys, emails and relative dates as words", () => {
    expect(parseKey("fixo-12")).toEqual({ prefix: "FIXO", number: 12 });
    expect(tokenize("key = FIXO-12 and assignee = a.b@x.com and created > -7d").filter((t) => t.t === "word").map((t) => (t as { v: string }).v)).toEqual([
      "key", "FIXO-12", "and", "assignee", "a.b@x.com", "and", "created", "-7d",
    ]);
    expect(resolveField("Issue Type")).toBe("type");
  });
});

describe("filtersToJql", () => {
  const names = { boardKey: (s: string) => ({ fixorata: "FIXO" })[s], user: (id: string) => ({ u1: "Ada Lovelace" })[id], epicKey: (id: string) => ({ e1: "FIXO-4" })[id], client: () => undefined };
  it("turns the board's filters into an equivalent query that parses", () => {
    const jql = filtersToJql(
      { ...DEFAULT_EXPLORER, product: ["fixorata"], assignee: ["me", "u1", "unassigned"], status: ["todo", "in_progress"], epic: ["e1"], quick: ["flagged", "overdue"], q: "refund", sort: "updated", dir: "desc" },
      names,
    );
    expect(jql).toBe(
      'project = FIXO AND text ~ refund AND (assignee in (currentUser(), "Ada Lovelace") OR assignee is EMPTY) AND status in ("To do", "In progress") AND epic = FIXO-4 AND due < startOfDay() AND status not in (Done, Canceled) AND flagged = true ORDER BY updated DESC',
    );
    expect(() => parseJql(jql)).not.toThrow();
  });
  it("is empty for no filters", () => {
    expect(filtersToJql(DEFAULT_EXPLORER, names)).toBe("");
  });
});

describe("withOrderBy", () => {
  it("replaces an existing ORDER BY and adds one when missing", () => {
    expect(withOrderBy("status = Done ORDER BY created DESC, key", "key", "asc")).toBe("status = Done ORDER BY key ASC");
    expect(withOrderBy("status = Done", "updated", "desc")).toBe("status = Done ORDER BY updated DESC");
    expect(withOrderBy("", "key", "asc")).toBe("ORDER BY key ASC");
    expect(withOrderBy("summary ~ sorted order   by due", "due", "desc")).toBe("summary ~ sorted ORDER BY due DESC");
  });
});

describe("jqlSuggest", () => {
  const dyn = { projects: ["FIXO", "PROP"], people: ["Ada Lovelace"], labels: ["e2e"], epics: ["FIXO-4"], sprints: [], clients: ["Acme"], ops: false };
  const labels = (src: string, caret = src.length) => jqlSuggest(src, caret, dyn).items.map((s) => s.label);
  it("suggests fields, then operators, then values, then keywords", () => {
    expect(labels("sta")).toContain("status");
    expect(labels("")).not.toContain("client");
    expect(labels("status ")).toEqual(expect.arrayContaining(["=", "IN", "NOT IN"]));
    expect(labels("status = ")).toEqual(expect.arrayContaining(["To do", "In progress", "Done"]));
    expect(labels("status in (Done, ")).toContain("Backlog");
    expect(labels("assignee = ")).toEqual(expect.arrayContaining(["currentUser()", "Ada Lovelace"]));
    expect(labels("project = ")).toEqual(["FIXO", "PROP"]);
    expect(labels("status = Done ")).toEqual(expect.arrayContaining(["AND", "OR", "ORDER BY"]));
    expect(labels("status = Done AND pri")).toEqual(["priority"]);
    expect(labels("labels is ")).toEqual(["EMPTY", "NOT EMPTY"]);
    expect(labels("status = Done ORDER BY ")).toContain("updated");
  });
  it("replaces the word being typed", () => {
    const s = jqlSuggest("status = Done AND pri", 21, dyn);
    expect(s.from).toBe(18);
    expect(s.items[0].insert).toBe("priority ");
  });
});
