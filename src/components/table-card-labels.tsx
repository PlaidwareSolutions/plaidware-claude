"use client";

import { useEffect, useRef } from "react";

/**
 * Phone layout for DataTableShell tables: copies each column's header text
 * onto its cells (`data-label`), which globals.css shows beside the value
 * when a row is laid out as a card under 640px. Re-labels when rows change.
 * Renders nothing visible; it reads its parent (the shell).
 */
export function TableCardLabels() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = ref.current?.parentElement;
    if (!root) return;
    const label = () => {
      for (const table of root.querySelectorAll("table")) {
        const heads: string[] = [];
        const headRow = table.querySelector("thead tr");
        for (const th of headRow ? Array.from(headRow.children) : []) {
          const text = (th.textContent ?? "").trim();
          const span = (th as HTMLTableCellElement).colSpan || 1;
          for (let i = 0; i < span; i++) heads.push(text);
        }
        for (const tr of table.querySelectorAll("tbody tr")) {
          let col = 0;
          for (const td of Array.from(tr.children) as HTMLTableCellElement[]) {
            const span = td.colSpan || 1;
            const want = span > 1 ? "" : (heads[col] ?? "");
            if (td.getAttribute("data-label") !== want) td.setAttribute("data-label", want);
            if (span > 1) td.setAttribute("data-span", "");
            col += span;
          }
        }
      }
    };
    label();
    const obs = new MutationObserver(label);
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  return <span ref={ref} hidden />;
}
