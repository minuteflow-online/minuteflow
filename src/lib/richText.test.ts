import { describe, expect, it } from "vitest";
import {
  ensureRichHtml,
  injectMagicWordHtml,
  isRichEmpty,
  renderBroadcastHtml,
  richTextToPlain,
  sanitizeRichHtml,
} from "./richText";

describe("sanitizeRichHtml", () => {
  it("keeps formatting tags", () => {
    expect(sanitizeRichHtml("<b>bold</b> <i>it</i> <u>u</u>")).toBe("<b>bold</b> <i>it</i> <u>u</u>");
  });

  it("keeps each highlight color and survives a removed highlight (Chrome output)", () => {
    const green = sanitizeRichHtml('<div><span style="background-color: rgb(220, 232, 221);">Hello <b>bold</b></span></div>');
    expect(green).toContain("background-color: rgb(220, 232, 221)");
    const purple = sanitizeRichHtml('<div><span style="background-color: rgb(237, 232, 245);">Hello</span></div>');
    expect(purple).toContain("background-color: rgb(237, 232, 245)");
    // Removing a highlight leaves an empty style on the bold tag; nothing should break.
    expect(sanitizeRichHtml('<div>Hello <b style="">bold world</b> today</div>')).toBe("<div>Hello <b>bold world</b> today</div>");
  });

  it("keeps highlight colour but drops other styles", () => {
    expect(sanitizeRichHtml('<span style="background-color: rgb(245, 236, 208); position: fixed">x</span>')).toBe(
      '<span style="background-color: rgb(245, 236, 208)">x</span>'
    );
  });

  it("forces safe link attributes and rejects javascript: hrefs", () => {
    expect(sanitizeRichHtml('<a href="https://a.com" onclick="x()">a</a>')).toBe(
      '<a href="https://a.com" target="_blank" rel="noopener noreferrer">a</a>'
    );
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">a</a>')).toBe(
      '<a target="_blank" rel="noopener noreferrer">a</a>'
    );
  });

  it("keeps https images and drops event handlers and bad sources", () => {
    expect(sanitizeRichHtml('<img src="https://x.co/a.png" onerror="alert(1)">')).toBe(
      '<img src="https://x.co/a.png" style="max-width: 100%; height: auto;">'
    );
    expect(sanitizeRichHtml('<img src="javascript:alert(1)">')).toBe("");
  });

  it("round-trips real Chrome editor output (bold, highlight, link, inline image)", () => {
    const chrome =
      '<b>hello</b> <span style="background-color: rgb(245, 236, 208);">world</span> <a href="https://minuteflow.click">link</a><img src="https://x.supabase.co/storage/v1/object/public/broadcasts/a.png" alt="">';
    expect(sanitizeRichHtml(chrome)).toBe(
      '<b>hello</b> <span style="background-color: rgb(245, 236, 208)">world</span> <a href="https://minuteflow.click" target="_blank" rel="noopener noreferrer">link</a><img src="https://x.supabase.co/storage/v1/object/public/broadcasts/a.png" style="max-width: 100%; height: auto;">'
    );
  });

  it("turns an image's data-size into an inline width (editor output with selection marker)", () => {
    const editor = '<img src="https://x.co/a.png" alt="" data-size="medium" style="width: 50%;" data-selected="">';
    expect(sanitizeRichHtml(editor)).toBe(
      '<img src="https://x.co/a.png" data-size="medium" style="width: 50%; max-width: 100%; height: auto;">'
    );
  });

  it("ignores unknown sizes and raw image styles", () => {
    expect(sanitizeRichHtml('<img src="https://x.co/a.png" data-size="huge" style="width: 900px; position: fixed">')).toBe(
      '<img src="https://x.co/a.png" style="max-width: 100%; height: auto;">'
    );
  });

  it("removes scripts and unknown tags", () => {
    expect(sanitizeRichHtml("hi<script>alert(1)</script><iframe src=x></iframe><table>t</table>")).toBe("hit");
  });
});

describe("renderBroadcastHtml", () => {
  it("escapes legacy plain-text bodies and keeps line breaks", () => {
    expect(renderBroadcastHtml("a < b & c\nnext")).toBe("a &lt; b &amp; c<br>next");
  });

  it("drops the editor's image-selection marker before saving", () => {
    expect(ensureRichHtml('<div><img src="https://x.co/a.png" data-size="small" data-selected=""></div>')).toBe(
      '<div><img src="https://x.co/a.png" data-size="small"></div>'
    );
  });

  it("does not double-escape editor output once wrapped", () => {
    expect(renderBroadcastHtml(ensureRichHtml("Tom &amp; Jerry"))).toBe("<div>Tom &amp; Jerry</div>");
  });
});

describe("empty / plain helpers", () => {
  it("treats editor leftovers as empty but an image as content", () => {
    expect(isRichEmpty("<div><br></div>")).toBe(true);
    expect(isRichEmpty('<img src="https://x.co/a.png">')).toBe(false);
  });

  it("extracts visible text", () => {
    expect(richTextToPlain("<div>one</div><div><b>two</b> &amp; three</div>")).toBe("one\ntwo & three\n");
  });
});

describe("injectMagicWordHtml", () => {
  it("inserts at a top-level boundary, never inside a tag", () => {
    const html = "<div>one</div><div>two</div><div>three</div><div>four</div><div>five</div>";
    const out = injectMagicWordHtml(html, "Magic word is <x>", () => 0);
    expect(out).toContain("<div><b>Magic word is &lt;x&gt;</b></div>");
    expect(out.indexOf("Magic word")).toBeGreaterThan(html.indexOf("three"));
    expect(out.replace("<div><b>Magic word is &lt;x&gt;</b></div>", "")).toBe(html);
  });

  it("appends when there is no boundary in the latter part", () => {
    expect(injectMagicWordHtml("<b>short</b>", "MW", () => 0)).toBe("<b>short</b><div><b>MW</b></div>");
  });
});
