import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csv", () => {
  it("quotes only when needed and escapes embedded quotes", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", now')).toBe('"say ""hi"", now"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(null)).toBe("");
  });

  it("assembles header + rows", () => {
    expect(toCsv(["a", "b"], [["1", "x,y"], [2, null]])).toBe('a,b\n1,"x,y"\n2,');
  });
});
