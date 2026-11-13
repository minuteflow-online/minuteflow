import { describe, expect, it } from "vitest";
import {
  ensureRichHtml,
  htmlFileToMessage,
  injectMagicWordHtml,
  injectMagicWordsHtml,
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
    expect(sanitizeRichHtml("hi<script>alert(1)</script><iframe src=x></iframe><form>t</form>")).toBe("hit");
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
    expect(out).toContain("<div>Magic word is &lt;x&gt;</div>");
    expect(out.indexOf("Magic word")).toBeGreaterThan(html.indexOf("three"));
    expect(out.replace("<div>Magic word is &lt;x&gt;</div>", "")).toBe(html);
  });

  it("appends when there is no boundary in the latter part", () => {
    expect(injectMagicWordHtml("<b>short</b>", "MW", () => 0)).toBe("<b>short</b><div>MW</div>");
  });

  it("never lands inside a designed card or table from HTML view", () => {
    const html = renderBroadcastHtml(
      '<div style="padding: 12px; border: 1px solid #e8dfd3">Intro card</div>' +
        "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>" +
        "<hr><p>Second to last</p><p>Last paragraph here</p>"
    );
    for (let pick = 0; pick < 5; pick++) {
      const out = injectMagicWordHtml(html, "Magic word is pineapple", () => pick);
      const at = out.indexOf("<div>Magic word is pineapple</div>");
      expect(at).toBeGreaterThan(out.indexOf("</table>"));
      expect(out.replace("<div>Magic word is pineapple</div>", "")).toBe(html);
    }
  });
});

describe("magic word placement inside an uploaded page", () => {
  const page =
    '<div style="background-color: rgb(250, 247, 242); padding: 24px">' +
    '<div style="background-color: rgb(30, 41, 59)"><h1>Title</h1></div>' +
    "<p>One</p><p>Two</p><p>Three</p>" +
    '<div style="background-color: rgb(255, 122, 69); border-top-left-radius: 16px"><p>Card A</p><p>Card B</p></div>' +
    "<p>Four</p><p>Five</p><p>Six</p></div>";

  it("goes between paragraphs inside the page wrapper, never inside a rounded card", () => {
    for (let pick = 0; pick < 6; pick++) {
      const out = injectMagicWordHtml(page, "MW", () => pick);
      const at = out.indexOf("<div>MW</div>");
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(out.lastIndexOf("</div>")); // inside the wrapper, not appended
      const cardStart = out.indexOf("Card A");
      const cardEnd = out.indexOf("Card B") + "Card B</p>".length;
      expect(at > cardStart && at < cardEnd).toBe(false);
    }
  });

  it("never goes inside a coloured banner such as a dark header", () => {
    for (let pick = 0; pick < 6; pick++) {
      const out = injectMagicWordsHtml(page, ["A", "B", "C"], (n, i) => (pick + i) % n);
      const bannerStart = out.indexOf("rgb(30, 41, 59)");
      const bannerEnd = out.indexOf("Title</h1></div>") + "Title</h1></div>".length;
      for (const w of ["A", "B", "C"]) {
        const at = out.indexOf(`<div>${w}</div>`);
        expect(at > bannerStart && at < bannerEnd).toBe(false);
      }
    }
  });
});

describe("HTML view design styles", () => {
  it("keeps spacing, borders and font size from hand-written HTML", () => {
    expect(
      sanitizeRichHtml('<div style="padding: 12px 16px; border: 1px solid #e8dfd3; border-radius: 12px; font-size: 15px">Card</div>')
    ).toBe('<div style="padding: 12px 16px; border: 1px solid #e8dfd3; border-radius: 12px; font-size: 15px">Card</div>');
  });

  it("keeps tables, dividers and cell spans", () => {
    expect(sanitizeRichHtml('<table><tbody><tr><th colspan="2">H</th></tr><tr><td rowspan="x">c</td></tr></tbody></table><hr>')).toBe(
      '<table><tbody><tr><th colspan="2">H</th></tr><tr><td>c</td></tr></tbody></table><hr>'
    );
  });

  it("rejects style values that could load or run anything", () => {
    expect(sanitizeRichHtml('<div style="border: url(https://x.com/a.png); width: expression(alert(1)); padding: 4px">x</div>')).toBe(
      '<div style="padding: 4px">x</div>'
    );
    expect(sanitizeRichHtml('<div style="margin: 0 \\61 bc">x</div>')).toBe("<div>x</div>");
  });

  it("drops a pasted page's head, title and style block", () => {
    expect(
      sanitizeRichHtml("<html><head><title>Memo</title><style>p{color:red}</style></head><body><p>Hi</p></body></html>")
    ).toBe("<p>Hi</p>");
  });

  it("paste mode keeps only colour, highlight, alignment and list style", () => {
    expect(
      sanitizeRichHtml('<p style="margin-top: 0pt; font-size: 11pt; color: #3d3229; text-align: center">Doc</p>', "paste")
    ).toBe('<p style="color: #3d3229; text-align: center">Doc</p>');
  });

  it("takes the body of an uploaded full-page .html file", () => {
    const page =
      '<!DOCTYPE html><html><head><title>Memo</title><style>p{color:red}</style></head>' +
      '<body style="margin:0">\n<div style="padding: 12px">Hello team</div>\n</body></html>';
    expect(htmlFileToMessage(page)).toBe('<div style="padding: 12px">Hello team</div>');
  });

  it("uses an uploaded fragment file as-is", () => {
    expect(htmlFileToMessage('  <p>Just a fragment</p>\n')).toBe("<p>Just a fragment</p>");
    expect(htmlFileToMessage("<!doctype html><html><head><title>T</title></head><p>No body tag</p></html>")).toBe(
      "<p>No body tag</p>"
    );
  });

  it("keeps an uploaded design's inlined fonts, spacing, circles and gradients", () => {
    const style =
      'font-family: &quot;Space Grotesk&quot;, sans-serif; letter-spacing: 1.5px; text-transform: uppercase; ' +
      "display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; " +
      "border-top-left-radius: 50%; background-image: linear-gradient(rgb(30, 41, 59) 0%, rgb(15, 23, 42) 100%)";
    expect(sanitizeRichHtml(`<span style="${style}">1</span>`)).toBe(
      '<span style="font-family: &quot;Space Grotesk&quot;, sans-serif; letter-spacing: 1.5px; text-transform: uppercase; ' +
        "display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; " +
        'border-top-left-radius: 50%; background-image: linear-gradient(rgb(30, 41, 59) 0%, rgb(15, 23, 42) 100%)">1</span>'
    );
  });

  it("rejects unsafe display, font and background-image values", () => {
    expect(
      sanitizeRichHtml('<div style="display: contents; font-family: a{b}; background-image: url(https://x.com/a.png)">x</div>')
    ).toBe("<div>x</div>");
  });

  it("re-sanitizing its own output changes nothing", () => {
    const once = sanitizeRichHtml('<p style="font-family: &quot;Inter&quot;, sans-serif; padding: 4px">x</p>');
    expect(sanitizeRichHtml(once)).toBe(once);
  });

  it("still treats plain-text memos as plain", () => {
    expect(renderBroadcastHtml("Line one\nLine <two>")).toBe("Line one<br>Line &lt;two&gt;");
  });
});
