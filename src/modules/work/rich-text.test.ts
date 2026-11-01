import { describe, expect, it } from "vitest";
import { isRichHtml, isRichTextEmpty, plainToHtml, richTextToPlain, toRichHtml } from "./rich-text";
import { normalizeRichText, renderRichText, sanitizeRichHtml } from "./rich-text-sanitize";

const IMG = "/api/work/attachments/0b6c2f2e-6b1a-4f9e-9a7c-1d2e3f4a5b6c";

describe("plain text", () => {
  it("is detected and escaped into paragraphs", () => {
    expect(isRichHtml("Fix <b>this</b>")).toBe(false);
    expect(plainToHtml("Line one\nline two\n\nNew para <script>")).toBe("<p>Line one<br>line two</p><p>New para &lt;script&gt;</p>");
    expect(toRichHtml("a & b")).toBe("<p>a &amp; b</p>");
    expect(toRichHtml("<p>x</p>")).toBe("<p>x</p>");
  });

  it("is stored as typed, and rendered escaped", () => {
    expect(normalizeRichText("  Steps: a < b  ")).toBe("Steps: a < b");
    expect(renderRichText("a < b")).toBe("<p>a &lt; b</p>");
  });
});

describe("sanitizeRichHtml", () => {
  it("keeps what the editor makes", () => {
    const html =
      '<h2>Repro</h2><p><strong>Bold</strong> <em>it</em> <u>u</u> <s>s</s> <code>x()</code></p>' +
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>done</p></div></li></ul>' +
      '<ol start="3"><li><p>three</p></li></ol><blockquote><p>q</p></blockquote><pre><code class="language-ts">let a = 1;</code></pre><hr>' +
      `<img src="${IMG}" alt="shot">`;
    const out = sanitizeRichHtml(html);
    for (const bit of ["<h2>", "<strong>", "<em>", "<u>", "<s>", "<code>", 'data-type="taskItem"', 'data-checked="true"', 'type="checkbox"', '<ol start="3">', "<blockquote>", 'class="language-ts"', "<hr />", `src="${IMG}"`]) {
      expect(out).toContain(bit);
    }
  });

  it("forces safe link attributes and drops script URLs", () => {
    expect(sanitizeRichHtml('<p><a href="https://x.dev" onclick="evil()">x</a></p>')).toBe(
      '<p><a href="https://x.dev" target="_blank" rel="noopener noreferrer nofollow">x</a></p>',
    );
    expect(sanitizeRichHtml('<p><a href="javascript:alert(1)">x</a></p>')).not.toContain("javascript");
  });

  it("strips scripts, styles, handlers and foreign images", () => {
    const out = sanitizeRichHtml(
      '<p style="color:red" onmouseover="x()">hi</p><script>alert(1)</script><iframe src="https://x"></iframe>' +
        '<img src="http://plain.dev/a.png"><img src="data:image/png;base64,AAAA"><img src="/api/other/1"><img src="https://cdn.dev/a.png" onerror="x()"><input type="text" value="x">',
    );
    expect(out).toBe('<p>hi</p><img src="https://cdn.dev/a.png" />');
  });
});

describe("mentions", () => {
  it("keeps mention spans but nothing else on spans", () => {
    const out = sanitizeRichHtml('<p><span data-type="mention" data-id="u1" data-label="Bob" onclick="x()" style="color:red">@Bob</span></p>');
    expect(out).toBe('<p><span data-type="mention" data-id="u1" data-label="Bob">@Bob</span></p>');
  });
});

describe("normalizeRichText", () => {
  it("turns an empty editor into an empty string", () => {
    expect(normalizeRichText("<p></p>")).toBe("");
    expect(normalizeRichText("<p> &nbsp; </p><p><br></p>")).toBe("");
  });

  it("drops trailing empty paragraphs", () => {
    expect(normalizeRichText("<p>Hi</p><p></p><p><br></p>")).toBe("<p>Hi</p>");
  });

  it("keeps an image-only body", () => {
    expect(normalizeRichText(`<p><img src="${IMG}"></p>`)).toContain("<img");
  });
});

describe("helpers", () => {
  it("extracts visible text", () => {
    expect(richTextToPlain("<h1>Title</h1><p>a &amp; b<br>c</p>")).toBe("Title\na & b\nc");
    expect(isRichTextEmpty("<p></p>")).toBe(true);
    expect(isRichTextEmpty("<hr>")).toBe(false);
    expect(isRichTextEmpty("plain")).toBe(false);
  });
});
