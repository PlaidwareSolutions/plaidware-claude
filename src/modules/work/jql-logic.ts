import {
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_SOURCES,
  WORK_ITEM_STATUSES,
  WORK_ITEM_TYPES,
  WORK_RESOLUTIONS,
} from "./contracts";
import type { ExplorerFilters } from "./explorer-logic";

/**
 * JQL — Jira's query language, for the work area's search page. Pure:
 * tokenizer, parser (AND / OR / NOT, parentheses, ORDER BY), the field
 * registry with each field's operators and values, relative dates,
 * autocomplete, and the board filters → JQL converter. queries.ts compiles
 * the parsed query to parameterised SQL; nothing here touches the database.
 *
 *   project = FIXO AND status in ("To do", "In progress") AND assignee = currentUser()
 *   text ~ "refund" AND created >= -14d ORDER BY priority DESC, updated DESC
 */

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export type JqlFieldType = "text" | "enum" | "user" | "date" | "number" | "key" | "project" | "labels" | "epic" | "sprint" | "bool" | "client";

export type JqlOp = "=" | "!=" | "~" | "!~" | ">" | ">=" | "<" | "<=" | "in" | "not in" | "is" | "is not";

type FieldDef = {
  type: JqlFieldType;
  aliases?: string[];
  /** Enum fields: stored value → the words that mean it. */
  values?: readonly string[];
  /** May be EMPTY (IS EMPTY / IS NOT EMPTY). */
  nullable?: boolean;
  sortable?: boolean;
  /** Ops only (client data). */
  opsOnly?: boolean;
  doc: string;
};

export const JQL_FIELDS: Record<string, FieldDef> = {
  project: { type: "project", aliases: ["space", "board", "product"], sortable: true, doc: "The board: key (FIXO), product slug or name" },
  key: { type: "key", aliases: ["issuekey", "id", "issue"], sortable: true, doc: "An item key, e.g. FIXO-12" },
  summary: { type: "text", aliases: ["title"], sortable: true, doc: "Words in the title" },
  description: { type: "text", nullable: true, doc: "Words in the description" },
  text: { type: "text", doc: "Words in the title, description or comments" },
  comment: { type: "text", aliases: ["comments"], doc: "Words in the comments" },
  status: { type: "enum", values: WORK_ITEM_STATUSES, sortable: true, doc: "Backlog, To do, In progress, In review, Done, Canceled" },
  type: { type: "enum", aliases: ["issuetype"], values: WORK_ITEM_TYPES, sortable: true, doc: "Feature, Enhancement, Bug, Task, Epic" },
  priority: { type: "enum", values: WORK_ITEM_PRIORITIES, sortable: true, doc: "Urgent, High, Medium, Low" },
  resolution: { type: "enum", values: WORK_RESOLUTIONS, nullable: true, doc: "Done, Fixed, Won't do, Duplicate, Cannot reproduce" },
  source: { type: "enum", values: WORK_ITEM_SOURCES, doc: "Internal, Client request, Incident" },
  assignee: { type: "user", nullable: true, sortable: true, doc: "currentUser(), a name or an email" },
  reporter: { type: "user", aliases: ["creator"], nullable: true, sortable: true, doc: "currentUser(), a name or an email" },
  watcher: { type: "user", aliases: ["watchers"], doc: "Someone watching the item" },
  labels: { type: "labels", aliases: ["label"], nullable: true, doc: "A label on the item" },
  epic: { type: "epic", aliases: ["parent", "epiclink"], nullable: true, doc: "The epic's key, e.g. FIXO-4" },
  sprint: { type: "sprint", nullable: true, doc: "openSprints(), or a sprint name" },
  flagged: { type: "bool", doc: "true or false" },
  points: { type: "number", aliases: ["storypoints", "estimate"], nullable: true, sortable: true, doc: "Story points" },
  created: { type: "date", aliases: ["createddate"], sortable: true, doc: "2026-11-01, -7d, startOfDay(), startOfWeek()" },
  updated: { type: "date", aliases: ["updateddate"], sortable: true, doc: "2026-11-01, -7d, startOfDay()" },
  due: { type: "date", aliases: ["duedate"], nullable: true, sortable: true, doc: "2026-11-01, now(), endOfWeek()" },
  resolved: { type: "date", aliases: ["resolutiondate"], nullable: true, sortable: true, doc: "When it was done or canceled" },
  client: { type: "client", aliases: ["requester", "organization"], nullable: true, opsOnly: true, doc: "The requesting client (ops only)" },
};

const FIELD_BY_NAME = new Map<string, string>();
for (const [name, def] of Object.entries(JQL_FIELDS)) {
  FIELD_BY_NAME.set(name, name);
  for (const a of def.aliases ?? []) FIELD_BY_NAME.set(a, name);
}

export function resolveField(word: string): string | null {
  return FIELD_BY_NAME.get(word.toLowerCase().replace(/[\s_-]/g, "")) ?? null;
}

const OPS_BY_TYPE: Record<JqlFieldType, JqlOp[]> = {
  text: ["~", "!~"],
  enum: ["=", "!=", "in", "not in"],
  user: ["=", "!=", "in", "not in"],
  date: ["=", "!=", ">", ">=", "<", "<="],
  number: ["=", "!=", ">", ">=", "<", "<="],
  key: ["=", "!=", "in", "not in"],
  project: ["=", "!=", "in", "not in"],
  labels: ["=", "!=", "in", "not in"],
  epic: ["=", "!=", "in", "not in"],
  sprint: ["=", "!=", "in", "not in"],
  bool: ["=", "!="],
  client: ["=", "!=", "in", "not in"],
};

export function operatorsFor(field: string): JqlOp[] {
  const def = JQL_FIELDS[field];
  if (!def) return [];
  return [...OPS_BY_TYPE[def.type], ...(def.nullable ? (["is", "is not"] as JqlOp[]) : [])];
}

/** Friendly names for enum values (also accepted as input). */
const ENUM_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  canceled: "Canceled",
  feature: "Feature",
  enhancement: "Enhancement",
  bug: "Bug",
  task: "Task",
  epic: "Epic",
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  fixed: "Fixed",
  wont_do: "Won't do",
  duplicate: "Duplicate",
  cannot_reproduce: "Cannot reproduce",
  internal: "Internal",
  client_request: "Client request",
  incident: "Incident",
};

/** Jira's own words for ours. */
const ENUM_SYNONYMS: Record<string, string> = {
  to_do: "todo",
  open: "todo",
  inprogress: "in_progress",
  inreview: "in_review",
  cancelled: "canceled",
  closed: "done",
  resolved: "done",
  story: "feature",
  newfeature: "feature",
  improvement: "enhancement",
  highest: "urgent",
  critical: "urgent",
  blocker: "urgent",
  lowest: "low",
  minor: "low",
  major: "high",
  wontdo: "wont_do",
  wont_fix: "wont_do",
  wontfix: "wont_do",
  cannotreproduce: "cannot_reproduce",
  cannot_reproduce: "cannot_reproduce",
  clientrequest: "client_request",
  request: "client_request",
};

export function enumLabel(v: string): string {
  return ENUM_LABELS[v] ?? v;
}

/** "In Progress" / "in-progress" / "IN_PROGRESS" → in_progress, or null when the field has no such value. */
export function normalizeEnum(field: string, raw: string): string | null {
  const values = JQL_FIELDS[field]?.values;
  if (!values) return null;
  const k = raw.trim().toLowerCase().replace(/[’']/g, "").replace(/[\s-]+/g, "_");
  if ((values as readonly string[]).includes(k)) return k;
  const syn = ENUM_SYNONYMS[k] ?? ENUM_SYNONYMS[k.replace(/_/g, "")];
  return syn && (values as readonly string[]).includes(syn) ? syn : null;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export type Token =
  | { t: "word"; v: string; pos: number; end: number }
  | { t: "str"; v: string; pos: number; end: number }
  | { t: "op"; v: "=" | "!=" | "~" | "!~" | ">" | ">=" | "<" | "<="; pos: number; end: number }
  | { t: "("; pos: number; end: number }
  | { t: ")"; pos: number; end: number }
  | { t: ","; pos: number; end: number };

export class JqlError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
    this.name = "JqlError";
  }
}

const WORD = /[A-Za-z0-9_\-.@:/+#]/;

/** Lenient when `partial` (autocomplete): an unterminated string becomes the last token. */
export function tokenize(src: string, partial = false): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      out.push({ t: c, pos: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i;
      let v = "";
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\" && i + 1 < src.length) {
          v += src[i + 1];
          i += 2;
          continue;
        }
        v += src[i++];
      }
      if (i >= src.length && !partial) throw new JqlError("A quoted value isn't closed", start);
      i++;
      out.push({ t: "str", v, pos: start, end: Math.min(i, src.length) });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "!=" || two === ">=" || two === "<=" || two === "!~") {
      out.push({ t: "op", v: two, pos: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === "=" || c === "~" || c === ">" || c === "<") {
      out.push({ t: "op", v: c, pos: i, end: i + 1 });
      i++;
      continue;
    }
    if (WORD.test(c)) {
      const start = i;
      while (i < src.length && WORD.test(src[i])) i++;
      out.push({ t: "word", v: src.slice(start, i), pos: start, end: i });
      continue;
    }
    if (partial) {
      i++;
      continue;
    }
    throw new JqlError(`Unexpected "${c}"`, i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type JqlValue = { kind: "lit"; v: string; quoted: boolean; pos: number } | { kind: "fn"; name: string; args: string[]; pos: number } | { kind: "empty"; pos: number };

export type JqlExpr =
  | { kind: "cmp"; field: string; op: JqlOp; values: JqlValue[]; pos: number }
  | { kind: "and"; left: JqlExpr; right: JqlExpr }
  | { kind: "or"; left: JqlExpr; right: JqlExpr }
  | { kind: "not"; expr: JqlExpr };

export type JqlQuery = { where: JqlExpr | null; orderBy: { field: string; dir: "asc" | "desc" }[] };

const kw = (tok: Token | undefined, word: string) => tok?.t === "word" && tok.v.toLowerCase() === word;

const FUNCTIONS = ["currentuser", "now", "startofday", "endofday", "startofweek", "endofweek", "startofmonth", "endofmonth", "opensprints", "closedsprints", "empty"];

export function parseJql(src: string, o: { ops: boolean } = { ops: true }): JqlQuery {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const end = () => i >= toks.length;
  const where = (tok: Token | undefined) => tok?.pos ?? src.length;

  function value(field: string): JqlValue {
    const tok = next();
    if (!tok) throw new JqlError(`Missing a value for ${field}`, src.length);
    if (tok.t === "str") return { kind: "lit", v: tok.v, quoted: true, pos: tok.pos };
    if (tok.t !== "word") throw new JqlError(`Expected a value for ${field}`, tok.pos);
    const low = tok.v.toLowerCase();
    if (peek()?.t === "(") {
      next();
      const args: string[] = [];
      while (peek() && peek()!.t !== ")") {
        const a = next()!;
        if (a.t === "word" || a.t === "str") args.push(a.v);
        else if (a.t !== ",") throw new JqlError("Unexpected token in function arguments", a.pos);
      }
      if (next()?.t !== ")") throw new JqlError(`${tok.v}( isn't closed`, tok.pos);
      if (!FUNCTIONS.includes(low)) throw new JqlError(`Unknown function ${tok.v}()`, tok.pos);
      return { kind: "fn", name: low, args, pos: tok.pos };
    }
    if (low === "empty" || low === "null") return { kind: "empty", pos: tok.pos };
    return { kind: "lit", v: tok.v, quoted: false, pos: tok.pos };
  }

  function clause(): JqlExpr {
    const ftok = next();
    if (!ftok || (ftok.t !== "word" && ftok.t !== "str")) throw new JqlError("Expected a field, e.g. status", where(ftok));
    const field = resolveField(ftok.v);
    if (!field) throw new JqlError(`Unknown field "${ftok.v}"`, ftok.pos);
    const def = JQL_FIELDS[field];
    if (def.opsOnly && !o.ops) throw new JqlError(`"${ftok.v}" is only available to ops`, ftok.pos);
    const optok = peek();
    let op: JqlOp;
    if (optok?.t === "op") {
      next();
      op = optok.v;
    } else if (kw(optok, "in")) {
      next();
      op = "in";
    } else if (kw(optok, "not") && kw(toks[i + 1], "in")) {
      i += 2;
      op = "not in";
    } else if (kw(optok, "is")) {
      next();
      if (kw(peek(), "not")) {
        next();
        op = "is not";
      } else op = "is";
    } else {
      throw new JqlError(`Expected an operator after ${ftok.v} (${operatorsFor(field).join(", ")})`, where(optok));
    }
    if (!operatorsFor(field).includes(op)) {
      throw new JqlError(`${ftok.v} doesn't support "${op}" — use ${operatorsFor(field).join(", ")}`, optok!.pos);
    }
    let values: JqlValue[];
    if (op === "in" || op === "not in") {
      const open = next();
      if (open?.t !== "(") throw new JqlError(`Expected ( after ${op.toUpperCase()}`, where(open));
      values = [];
      while (peek() && peek()!.t !== ")") {
        values.push(value(field));
        if (peek()?.t === ",") next();
        else break;
      }
      if (next()?.t !== ")") throw new JqlError("The list isn't closed with )", where(peek()));
      if (values.length === 0) throw new JqlError("An empty list matches nothing", open.pos);
    } else if (op === "is" || op === "is not") {
      const v = value(field);
      if (v.kind !== "empty") throw new JqlError(`Use ${op.toUpperCase()} EMPTY`, v.pos);
      values = [v];
    } else {
      values = [value(field)];
    }
    return { kind: "cmp", field, op, values, pos: ftok.pos };
  }

  function primary(): JqlExpr {
    if (peek()?.t === "(") {
      const open = next()!;
      const e = orExpr();
      if (next()?.t !== ")") throw new JqlError("A ( isn't closed", open.pos);
      return e;
    }
    return clause();
  }
  function notExpr(): JqlExpr {
    if (kw(peek(), "not") && !kw(toks[i + 1], "in")) {
      next();
      return { kind: "not", expr: notExpr() };
    }
    return primary();
  }
  function andExpr(): JqlExpr {
    let left = notExpr();
    while (kw(peek(), "and")) {
      next();
      left = { kind: "and", left, right: notExpr() };
    }
    return left;
  }
  function orExpr(): JqlExpr {
    let left = andExpr();
    while (kw(peek(), "or")) {
      next();
      left = { kind: "or", left, right: andExpr() };
    }
    return left;
  }

  const q: JqlQuery = { where: null, orderBy: [] };
  if (!end() && !kw(peek(), "order")) q.where = orExpr();
  if (kw(peek(), "order")) {
    next();
    if (!kw(next(), "by")) throw new JqlError("Expected ORDER BY", where(toks[i - 1]));
    do {
      const f = next();
      if (!f || f.t !== "word") throw new JqlError("Expected a field to order by", where(f));
      const field = resolveField(f.v);
      if (!field || !JQL_FIELDS[field].sortable) throw new JqlError(`Can't order by "${f.v}"`, f.pos);
      let dir: "asc" | "desc" = "asc";
      if (kw(peek(), "asc") || kw(peek(), "desc")) dir = (next() as { v: string }).v.toLowerCase() as "asc" | "desc";
      q.orderBy.push({ field, dir });
    } while (peek()?.t === "," && next());
  }
  if (!end()) throw new JqlError(`Unexpected "${(peek() as { v?: string }).v ?? peek()!.t}" — join clauses with AND or OR`, peek()!.pos);
  return q;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 } as const;

/**
 * A date value as a timestamp: "2026-11-01", "2026-11-01 14:30", "-7d" / "+2w"
 * / "-4h" (relative to now), or now() / startOfDay() / endOfWeek()… Weeks
 * start on Monday; days are UTC (the display zone is applied at render).
 */
export function resolveDate(v: JqlValue, now: Date): Date | null {
  if (v.kind === "empty") return null;
  if (v.kind === "fn") {
    const d = new Date(now);
    const day = (x: Date) => new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
    const offset = Number(v.args[0] ?? 0);
    switch (v.name) {
      case "now":
        return d;
      case "startofday":
        return new Date(day(d).getTime() + offset * UNIT_MS.d);
      case "endofday":
        return new Date(day(d).getTime() + (offset + 1) * UNIT_MS.d - 1);
      case "startofweek": {
        const s = day(d);
        s.setUTCDate(s.getUTCDate() - ((s.getUTCDay() + 6) % 7) + offset * 7);
        return s;
      }
      case "endofweek": {
        const s = day(d);
        s.setUTCDate(s.getUTCDate() - ((s.getUTCDay() + 6) % 7) + 7 + offset * 7);
        return new Date(s.getTime() - 1);
      }
      case "startofmonth":
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
      case "endofmonth":
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 1) - 1);
      default:
        throw new JqlError(`${v.name}() isn't a date`, v.pos);
    }
  }
  const s = v.v.trim();
  const rel = /^([+-]?)(\d{1,4})([mhdw])$/i.exec(s);
  if (rel) {
    const ms = Number(rel[2]) * UNIT_MS[rel[3].toLowerCase() as keyof typeof UNIT_MS];
    return new Date(now.getTime() + (rel[1] === "-" ? -ms : ms));
  }
  const abs = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(s);
  if (abs) {
    const d = new Date(Date.UTC(+abs[1], +abs[2] - 1, +abs[3], abs[4] ? +abs[4] : 0, abs[5] ? +abs[5] : 0));
    if (!Number.isNaN(d.getTime())) return d;
  }
  throw new JqlError(`"${s}" isn't a date — use 2026-11-01, -7d or startOfDay()`, v.pos);
}

/** "FIXO-12" → { prefix, number }. */
export function parseKey(s: string): { prefix: string; number: number } | null {
  const m = /^([A-Za-z][A-Za-z0-9]{1,5})-(\d{1,7})$/.exec(s.trim());
  return m ? { prefix: m[1].toUpperCase(), number: Number(m[2]) } : null;
}

// ---------------------------------------------------------------------------
// Board filters → JQL ("Switch to JQL")
// ---------------------------------------------------------------------------

const quote = (s: string) => (/^[A-Za-z0-9_\-.@]+$/.test(s) && !["and", "or", "not", "in", "is", "empty", "null", "order", "by"].includes(s.toLowerCase()) ? s : `"${s.replace(/["\\]/g, "\\$&")}"`);
const inList = (field: string, vals: string[]) => (vals.length === 1 ? `${field} = ${vals[0]}` : `${field} in (${vals.join(", ")})`);

/** The board's filter state as an equivalent query; `names` turns ids into the words JQL uses. */
export function filtersToJql(
  f: ExplorerFilters,
  names: { boardKey: (slug: string) => string | undefined; user: (id: string) => string | undefined; epicKey: (id: string) => string | undefined; client: (id: string) => string | undefined },
): string {
  const parts: string[] = [];
  if (f.product.length) parts.push(inList("project", f.product.map((s) => quote(names.boardKey(s) ?? s))));
  if (f.q?.trim()) parts.push(`text ~ ${quote(f.q.trim())}`);
  const people = f.assignee.filter((a) => a !== "unassigned").map((a) => (a === "me" ? "currentUser()" : quote(names.user(a) ?? a)));
  if (people.length && f.assignee.includes("unassigned")) parts.push(`(${inList("assignee", people)} OR assignee is EMPTY)`);
  else if (people.length) parts.push(inList("assignee", people));
  else if (f.assignee.includes("unassigned")) parts.push("assignee is EMPTY");
  if (f.status.length) parts.push(inList("status", f.status.map((s) => quote(enumLabel(s)))));
  if (f.type.length) parts.push(inList("type", f.type.map((s) => quote(enumLabel(s)))));
  if (f.priority.length) parts.push(inList("priority", f.priority.map((s) => quote(enumLabel(s)))));
  if (f.label.length) parts.push(inList("labels", f.label.map(quote)));
  const epics = f.epic.filter((e) => e !== "none").map((e) => quote(names.epicKey(e) ?? e));
  if (epics.length && f.epic.includes("none")) parts.push(`(${inList("epic", epics)} OR epic is EMPTY)`);
  else if (epics.length) parts.push(inList("epic", epics));
  else if (f.epic.includes("none")) parts.push("epic is EMPTY");
  const clients = f.client.filter((c) => c !== "none").map((c) => quote(names.client(c) ?? c));
  if (clients.length && f.client.includes("none")) parts.push(`(${inList("client", clients)} OR client is EMPTY)`);
  else if (clients.length) parts.push(inList("client", clients));
  else if (f.client.includes("none")) parts.push("client is EMPTY");
  if (f.quick.includes("mine")) parts.push("assignee = currentUser()");
  if (f.quick.includes("recent")) parts.push("updated >= -7d");
  if (f.quick.includes("overdue")) parts.push('due < startOfDay() AND status not in (Done, Canceled)');
  if (f.quick.includes("flagged")) parts.push("flagged = true");
  if (f.quick.includes("requests")) parts.push('source = "Client request"');
  const sortField: Record<string, string | null> = { rank: null, key: "key", priority: "priority", status: "status", due: "due", updated: "updated", created: "created" };
  const order = sortField[f.sort] ? ` ORDER BY ${sortField[f.sort]} ${f.dir.toUpperCase()}` : "";
  return parts.join(" AND ") + order;
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

export type JqlSuggestion = { label: string; insert: string; hint?: string };
export type JqlDynamic = { projects: string[]; people: string[]; labels: string[]; epics: string[]; sprints: string[]; clients: string[]; ops: boolean };

const fieldList = (ops: boolean) => Object.entries(JQL_FIELDS).filter(([, d]) => ops || !d.opsOnly);

/**
 * What can come next at the caret: fields, operators, values for the field
 * on the left, or AND / OR / ORDER BY. `from`/`to` is the text to replace.
 */
export function jqlSuggest(src: string, caret: number, dyn: JqlDynamic): { from: number; to: number; items: JqlSuggestion[] } {
  const before = src.slice(0, caret);
  const toks = tokenize(before, true);
  const last = toks[toks.length - 1];
  const typing = last && last.end === before.length && (last.t === "word" || last.t === "str") ? last : null;
  const prefix = typing ? typing.v.toLowerCase() : "";
  const prev = typing ? toks.slice(0, -1) : toks;
  const p1 = prev[prev.length - 1];
  const from = typing ? typing.pos : caret;
  // Fields, operators and keywords match from the start; values (names, labels) anywhere, starts first.
  const match = (items: JqlSuggestion[], loose = false) => {
    const starts = items.filter((s) => s.label.toLowerCase().startsWith(prefix) || s.insert.toLowerCase().replace(/^"/, "").startsWith(prefix));
    const inside = loose ? items.filter((s) => !starts.includes(s) && s.label.toLowerCase().includes(prefix)) : [];
    return [...starts, ...inside].slice(0, 12);
  };
  const fields = () => match(fieldList(dyn.ops).map(([name, d]) => ({ label: name, insert: `${name} `, hint: d.doc })));
  const keywords = () => match([{ label: "AND", insert: "AND " }, { label: "OR", insert: "OR " }, { label: "ORDER BY", insert: "ORDER BY " }, { label: "NOT", insert: "NOT " }]);

  // Which field is the clause on? Walk back over the operator / list.
  let j = prev.length - 1;
  let inList = false;
  while (j >= 0 && (prev[j].t === "," || prev[j].t === "str" || (prev[j].t === "word" && !resolveField((prev[j] as { v: string }).v) && !["in", "not", "is"].includes((prev[j] as { v: string }).v.toLowerCase())))) j--;
  if (j >= 0 && prev[j].t === "(") {
    inList = true;
    j--;
  }
  const opTok = prev[j];
  const opWord = opTok?.t === "word" ? opTok.v.toLowerCase() : opTok?.t === "op" ? opTok.v : null;
  let fieldTok = opTok;
  let fieldIdx = j;
  if (opWord === "in" && prev[j - 1]?.t === "word" && (prev[j - 1] as { v: string }).v.toLowerCase() === "not") fieldIdx = j - 2;
  else if (opWord === "not" && prev[j - 1]?.t === "word" && (prev[j - 1] as { v: string }).v.toLowerCase() === "is") fieldIdx = j - 2;
  else fieldIdx = j - 1;
  fieldTok = prev[fieldIdx];
  const field = fieldTok && (fieldTok.t === "word" || fieldTok.t === "str") ? resolveField(fieldTok.v) : null;

  // ORDER BY context.
  const orderAt = prev.findIndex((t, k) => t.t === "word" && t.v.toLowerCase() === "order" && prev[k + 1]?.t === "word" && (prev[k + 1] as { v: string }).v.toLowerCase() === "by");
  if (orderAt >= 0) {
    if (p1?.t === "word" && resolveField(p1.v)) return { from, to: caret, items: match([{ label: "ASC", insert: "ASC" }, { label: "DESC", insert: "DESC" }]) };
    return { from, to: caret, items: match(fieldList(dyn.ops).filter(([, d]) => d.sortable).map(([name]) => ({ label: name, insert: `${name} ` }))) };
  }

  // Start of a clause.
  if (!p1 || p1.t === "(" && !inList || (p1.t === "word" && ["and", "or", "not"].includes(p1.v.toLowerCase()) && !(p1.v.toLowerCase() === "not" && field))) {
    return { from, to: caret, items: fields() };
  }
  // Right after a field: operators.
  if (p1.t === "word" && resolveField(p1.v) && p1 === prev[prev.length - 1] && !["is", "in"].includes(p1.v.toLowerCase())) {
    const f = resolveField(p1.v)!;
    const ops = operatorsFor(f).map((o) => ({ label: o.toUpperCase(), insert: o === "in" || o === "not in" ? `${o} (` : `${o} ` }));
    return { from, to: caret, items: match(ops) };
  }
  // After IS / IS NOT: EMPTY.
  if (opWord === "is" || opWord === "not" && prev[j - 1]?.t === "word" && (prev[j - 1] as { v: string }).v.toLowerCase() === "is") {
    if (p1.t === "word" && p1.v.toLowerCase() === "is") return { from, to: caret, items: match([{ label: "EMPTY", insert: "EMPTY " }, { label: "NOT EMPTY", insert: "NOT EMPTY " }]) };
    if (p1.t === "word" && p1.v.toLowerCase() === "not") return { from, to: caret, items: match([{ label: "EMPTY", insert: "EMPTY " }]) };
  }
  // A value is expected: after an operator, after "(" of IN, or after "," in the list.
  const expectingValue = p1.t === "op" || (inList && (p1.t === "(" || p1.t === ","));
  if (field && expectingValue) {
    const def = JQL_FIELDS[field];
    const q = (s: string) => (/^[A-Za-z0-9_\-.@]+$/.test(s) ? s : `"${s}"`);
    const tail = inList ? "" : " ";
    let vals: JqlSuggestion[] = [];
    if (def.values) vals = def.values.map((v) => ({ label: enumLabel(v), insert: q(enumLabel(v)) + tail }));
    else if (def.type === "user") vals = [{ label: "currentUser()", insert: "currentUser()" + tail }, ...dyn.people.map((n) => ({ label: n, insert: q(n) + tail }))];
    else if (def.type === "project") vals = dyn.projects.map((n) => ({ label: n, insert: q(n) + tail }));
    else if (def.type === "labels") vals = dyn.labels.map((n) => ({ label: n, insert: q(n) + tail }));
    else if (def.type === "epic") vals = dyn.epics.map((n) => ({ label: n, insert: q(n) + tail }));
    else if (def.type === "sprint") vals = [{ label: "openSprints()", insert: "openSprints()" + tail }, ...dyn.sprints.map((n) => ({ label: n, insert: q(n) + tail }))];
    else if (def.type === "client") vals = dyn.clients.map((n) => ({ label: n, insert: q(n) + tail }));
    else if (def.type === "bool") vals = [{ label: "true", insert: "true" + tail }, { label: "false", insert: "false" + tail }];
    else if (def.type === "date")
      vals = [
        { label: "startOfDay()", insert: "startOfDay()" + tail, hint: "today" },
        { label: "-7d", insert: "-7d" + tail, hint: "7 days ago" },
        { label: "-30d", insert: "-30d" + tail, hint: "30 days ago" },
        { label: "startOfWeek()", insert: "startOfWeek()" + tail },
        { label: "startOfMonth()", insert: "startOfMonth()" + tail },
        { label: "now()", insert: "now()" + tail },
      ];
    return { from, to: caret, items: match(vals, true) };
  }
  // After a complete clause (a value, or a closing paren).
  return { from, to: caret, items: keywords() };
}

/** The query with its ORDER BY replaced (column-header sorting on the search page). */
export function withOrderBy(jql: string, field: string, dir: "asc" | "desc"): string {
  const base = jql.replace(/\s*\border\s+by\b[\s\S]*$/i, "").trim();
  return `${base}${base ? " " : ""}ORDER BY ${field} ${dir.toUpperCase()}`;
}

/** The first ORDER BY as the list's sort state, when it's a column the list can sort. */
export function jqlSortState(q: JqlQuery | null): { sort: "key" | "priority" | "status" | "due" | "updated" | "created" | "rank"; dir: "asc" | "desc" } {
  const o = q?.orderBy[0];
  const cols = ["key", "priority", "status", "due", "updated", "created"] as const;
  return o && (cols as readonly string[]).includes(o.field) ? { sort: o.field as (typeof cols)[number], dir: o.dir } : { sort: "rank", dir: "asc" };
}
