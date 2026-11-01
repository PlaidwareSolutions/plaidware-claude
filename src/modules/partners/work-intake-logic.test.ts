import { describe, expect, it } from "vitest";
import { sanitizeRichHtml } from "../work/rich-text-sanitize";
import { decodeScreenshot, reportDescriptionHtml, reportLabels, reportTitle, workItemTypeFor } from "./work-intake-logic";

describe("report → ticket fields", () => {
  it("maps the kind to a work item type and labels", () => {
    expect(workItemTypeFor("bug")).toBe("bug");
    expect(workItemTypeFor("idea")).toBe("feature");
    expect(workItemTypeFor("feedback")).toBe("enhancement");
    expect(reportLabels("fixorata", "bug")).toEqual(["fixorata-report", "bug-report"]);
    expect(reportLabels("fixorata", "idea")).toEqual(["fixorata-report", "idea"]);
  });

  it("titles from the given title, else the first non-empty line, cut at a word", () => {
    expect(reportTitle({ title: " Printer jams ", message: "x", kind: "bug" })).toBe("Printer jams");
    expect(reportTitle({ message: "\n\nReceipt total wrong\nmore detail", kind: "bug" })).toBe("Receipt total wrong");
    const long = `${"word ".repeat(40)}end`;
    const t = reportTitle({ message: long, kind: "feedback" });
    expect(t.length).toBeLessThanOrEqual(121);
    expect(t.endsWith("word…")).toBe(true);
    expect(reportTitle({ message: "   ", kind: "idea" })).toBe("Idea");
  });
});

describe("reportDescriptionHtml", () => {
  it("escapes everything the partner sent and survives the sanitiser intact", () => {
    const html = reportDescriptionHtml({
      kind: "bug",
      message: "Total shows <b>$0</b>\nafter refund\n\nSecond <script>x</script> para",
      appDisplayName: "Fixorata",
      reporterRole: "<owner>",
      page: { name: "POS", path: "/pos?tab=1" },
      userAgent: "Mozilla/5.0",
      viewport: { width: 1280, height: 800 },
      reportUrl: "https://app.fixorata.com/admin/feedback/r1",
      screenshotSrc: "/api/work/attachments/0b6c2f2e-6b1a-4f9e-9a7c-1d2e3f4a5b6c",
    });
    expect(html).toContain("<p>Total shows &lt;b&gt;$0&lt;/b&gt;<br>after refund</p><p>Second &lt;script&gt;x&lt;/script&gt; para</p>");
    expect(html).toContain("<strong>Reported by:</strong> &lt;owner&gt;");
    expect(html).toContain("POS — <code>/pos?tab=1</code>");
    expect(html).toContain("1280 × 800");
    expect(html).toContain('<img src="/api/work/attachments/0b6c2f2e-6b1a-4f9e-9a7c-1d2e3f4a5b6c" alt="Screenshot">');
    const clean = sanitizeRichHtml(html);
    expect(clean).toContain("<img");
    expect(clean).toContain('href="https://app.fixorata.com/admin/feedback/r1"');
    expect(clean).not.toContain("<script");
  });

  it("never names the client, and leaves out rows it has nothing for", () => {
    const html = reportDescriptionHtml({ kind: "idea", message: "Dark mode", appDisplayName: "Fixorata", reporterRole: "front_desk" });
    expect(html).toContain("<strong>Reported by:</strong> front desk</p>");
    expect(html).not.toContain("@");
    expect(reportDescriptionHtml({ kind: "idea", message: "x", appDisplayName: "Fixorata" })).not.toContain("Details");
    expect(html).not.toContain("<img");
  });
});

describe("decodeScreenshot", () => {
  it("accepts plain or data-URL base64 and refuses anything else", () => {
    expect(Array.from(decodeScreenshot("iVBORw0KGgo=")!.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(decodeScreenshot("data:image/png;base64,iVBORw0KGgo=")).not.toBeNull();
    expect(decodeScreenshot("not base64!")).toBeNull();
    expect(decodeScreenshot("")).toBeNull();
  });
});
