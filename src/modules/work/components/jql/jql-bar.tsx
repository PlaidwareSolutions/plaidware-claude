"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleHelp, Link2, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { WORK, withQuery } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { JQL_FIELDS, jqlSuggest, operatorsFor, type JqlDynamic, type JqlSuggestion } from "../../jql-logic";

const EXAMPLES: { label: string; jql: string }[] = [
  { label: "My open work", jql: "assignee = currentUser() AND status not in (Done, Canceled) ORDER BY priority DESC, updated DESC" },
  { label: "Bugs reported this week", jql: "type = Bug AND created >= startOfWeek() ORDER BY created DESC" },
  { label: "Unassigned in To do", jql: 'status = "To do" AND assignee is EMPTY ORDER BY priority DESC' },
  { label: "Overdue", jql: "due < startOfDay() AND status not in (Done, Canceled) ORDER BY due ASC" },
  { label: "Flagged", jql: "flagged = true ORDER BY updated DESC" },
  { label: "Reports from partner apps", jql: 'labels = fixorata-report ORDER BY created DESC' },
  { label: "Mentions of “refund”", jql: 'text ~ "refund" ORDER BY updated DESC' },
];

/**
 * Jira's advanced search box: type JQL with suggestions (fields → operators →
 * values → AND / OR / ORDER BY), Enter runs it, the URL carries it (?jql=),
 * and a mistake points at the spot that's wrong.
 */
export function JqlBar({ initial, error, dyn }: { initial: string; error: { message: string; pos: number | null } | null; dyn: JqlDynamic }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(initial);
  const [caret, setCaret] = useState(initial.length);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [help, setHelp] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // A new search from the server (back/forward, Switch to JQL) replaces the text.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setText(initial);
  }

  const sugg = useMemo(() => jqlSuggest(text, caret, dyn), [text, caret, dyn]);
  const items = sugg.items;
  const showList = open && items.length > 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  function run(jql = text) {
    setOpen(false);
    start(() => router.push(withQuery(WORK.search, { jql: jql.trim() || undefined }), { scroll: false }));
  }

  function apply(s: JqlSuggestion) {
    const next = text.slice(0, sugg.from) + s.insert + text.slice(sugg.to);
    const pos = sugg.from + s.insert.length;
    setText(next);
    setCaret(pos);
    setActive(0);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  }

  const sync = () => setCaret(ref.current?.selectionStart ?? text.length);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <textarea
            ref={ref}
            rows={1}
            value={text}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            role="combobox"
            aria-label="JQL query"
            aria-autocomplete="list"
            aria-controls="jql-suggestions"
            aria-expanded={showList}
            placeholder='project = FIXO AND status = "In progress" ORDER BY updated DESC'
            className={cn(
              "block min-h-9 w-full resize-none rounded-[3px] border-2 bg-background py-1.5 pr-3 pl-8 font-mono text-sm leading-5 outline-none placeholder:text-muted-foreground focus:border-info",
              error && "border-destructive focus:border-destructive",
            )}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              setOpen(true);
              setActive(0);
            }}
            onClick={() => {
              sync();
              setOpen(true);
            }}
            onKeyUp={(e) => ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) && sync()}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (showList && e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => (a + 1) % items.length);
              } else if (showList && e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => (a - 1 + items.length) % items.length);
              } else if (showList && (e.key === "Tab" || (e.key === "Enter" && !e.ctrlKey && !e.metaKey))) {
                e.preventDefault();
                apply(items[active] ?? items[0]);
              } else if (e.key === "Enter") {
                e.preventDefault();
                run();
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          {showList && (
            <ul id="jql-suggestions" role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-[3px] border bg-popover py-1 shadow-lg">
              {items.map((s, i) => (
                <li key={`${s.label}-${i}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={cn("flex w-full cursor-pointer items-baseline gap-3 px-3 py-1.5 text-left text-sm", i === active ? "bg-info/10 text-info" : "hover:bg-accent")}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      apply(s);
                    }}
                    onMouseEnter={() => setActive(i)}
                  >
                    <span className="font-mono">{s.label}</span>
                    {s.hint && <span className="truncate text-xs text-muted-foreground">{s.hint}</span>}
                  </button>
                </li>
              ))}
              <li className="border-t px-3 pt-1.5 pb-1 text-[11px] text-muted-foreground">Tab or Enter to insert · Enter again to search</li>
            </ul>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button className="h-9 flex-1 cursor-pointer rounded-[3px] bg-info text-white hover:bg-info/90 sm:flex-none dark:text-background" disabled={pending} onClick={() => run()}>
            {pending ? "Searching…" : "Search"}
          </Button>
          <Button variant="outline" size="icon" className="size-9 cursor-pointer rounded-[3px]" title="JQL fields and examples" aria-label="JQL help" onClick={() => setHelp(true)}>
            <CircleHelp className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-9 cursor-pointer rounded-[3px]"
            title="Copy a link to this search"
            aria-label="Copy link"
            onClick={() => {
              const url = new URL(withQuery(WORK.search, { jql: text.trim() || undefined }), window.location.origin).toString();
              void navigator.clipboard.writeText(url).then(() => toast.success("Link to this search copied"), () => toast.error("Couldn't copy the link"));
            }}
          >
            <Link2 className="size-4" />
          </Button>
          <Button asChild variant="outline" size="sm" className="h-9 cursor-pointer rounded-[3px]" title="Back to the board's filters">
            <Link href={WORK.all}>
              <SlidersHorizontal className="size-4" /> Basic
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-[3px] border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <div className="font-medium text-destructive">{error.message}</div>
          {error.pos != null && initial && (
            <pre className="mt-1 overflow-x-auto font-mono text-xs text-muted-foreground">
              {initial}
              {"\n"}
              {" ".repeat(Math.min(error.pos, initial.length))}^
            </pre>
          )}
        </div>
      )}

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {EXAMPLES.map((x) => (
          <button
            key={x.label}
            type="button"
            className="shrink-0 cursor-pointer rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:border-info hover:text-info"
            title={x.jql}
            onClick={() => {
              setText(x.jql);
              run(x.jql);
            }}
          >
            {x.label}
          </button>
        ))}
      </div>

      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>JQL — search like Jira</DialogTitle>
            <DialogDescription>
              Combine clauses with <code>AND</code>, <code>OR</code>, <code>NOT</code> and parentheses; finish with <code>ORDER BY field ASC|DESC</code>. Quote values with spaces.
            </DialogDescription>
          </DialogHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Field</th>
                <th className="py-1.5 pr-3 font-medium">Operators</th>
                <th className="py-1.5 font-medium">Values</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(JQL_FIELDS)
                .filter(([, d]) => dyn.ops || !d.opsOnly)
                .map(([name, d]) => (
                  <tr key={name} className="border-b align-top last:border-0">
                    <td className="py-1.5 pr-3 font-mono">{name}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{operatorsFor(name).map((o) => o.toUpperCase()).join("  ")}</td>
                    <td className="py-1.5 text-muted-foreground">{d.doc}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="font-medium">Examples</div>
            {EXAMPLES.map((x) => (
              <button
                key={x.label}
                type="button"
                className="cursor-pointer rounded-[3px] bg-muted px-2 py-1.5 text-left font-mono text-xs hover:bg-accent"
                onClick={() => {
                  setHelp(false);
                  setText(x.jql);
                  run(x.jql);
                }}
              >
                {x.jql}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
