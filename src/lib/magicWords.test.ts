import { describe, expect, it } from "vitest";
import { magicWordLabel, magicWordsMatch, parseMagicWords, serializeMagicWords } from "./magicWords";
import { injectMagicWordHtml, injectMagicWordsHtml, renderBroadcastHtml } from "./richText";

describe("magic words", () => {
  it("reads one stored word exactly as before", () => {
    expect(parseMagicWords("pineapple")).toEqual(["pineapple"]);
    expect(magicWordsMatch("pineapple", " Pineapple ")).toBe(true);
    expect(magicWordsMatch("pineapple", "mango")).toBe(false);
  });

  it("stores several words comma-separated, dropping blanks and repeats", () => {
    expect(serializeMagicWords(["pineapple", " ", "Mango", "mango"])).toBe("pineapple, Mango");
    expect(serializeMagicWords(["", " "])).toBeNull();
  });

  it("needs every word, in any order and any case", () => {
    expect(magicWordsMatch("pineapple, mango", "MANGO, pineapple")).toBe(true);
    expect(magicWordsMatch("pineapple, mango", "pineapple")).toBe(false);
    expect(magicWordsMatch("pineapple, mango", "pineapple, kiwi")).toBe(false);
  });

  it("matches anything when there are no words", () => {
    expect(magicWordsMatch(null, "")).toBe(true);
  });

  it("labels words with their position only when there are several", () => {
    expect(magicWordLabel("pineapple", 0, 1)).toBe("Magic word is pineapple");
    expect(magicWordLabel("mango", 1, 2)).toBe("Magic word 2 of 2 is mango");
  });
});

describe("injectMagicWordsHtml", () => {
  const html = Array.from({ length: 9 }, (_, i) => `<p>Paragraph ${i + 1}</p>`).join("");
  const lines = ["Magic word 1 of 3 is a", "Magic word 2 of 3 is b", "Magic word 3 of 3 is c"];

  it("spreads the words across the whole message, in order", () => {
    const out = injectMagicWordsHtml(html, lines, () => 0);
    const at = lines.map((l) => out.indexOf(l));
    expect(at.every((p) => p > 0)).toBe(true);
    expect(at[0]).toBeLessThan(out.indexOf("Paragraph 4"));
    expect(at[1]).toBeGreaterThan(out.indexOf("Paragraph 3"));
    expect(at[1]).toBeLessThan(out.indexOf("Paragraph 7"));
    expect(at[2]).toBeGreaterThan(out.indexOf("Paragraph 6"));
    let stripped = out;
    for (const l of lines) stripped = stripped.replace(`<div>${l}</div>`, "");
    expect(stripped).toBe(html);
  });

  it("appends what doesn't fit in a message without boundaries", () => {
    expect(injectMagicWordsHtml("<b>short</b>", ["A", "B"], () => 0)).toBe("<b>short</b><div>A</div><div>B</div>");
  });

  it("works on plain-text memos", () => {
    const out = injectMagicWordsHtml(renderBroadcastHtml("one\ntwo\nthree\nfour"), ["X", "Y"], () => 0);
    expect(out.indexOf("X")).toBeLessThan(out.indexOf("Y"));
    expect(out).toContain("<div>X</div>");
  });
});

describe("magic words blend into the memo's own paragraphs", () => {
  const para = (i: number) => `<p style="font-size: 15px; color: rgb(61, 50, 41)">Paragraph ${i} has enough real text to hide a word in.</p>`;
  // Like an uploaded memo: page wrapper, dark header, then a card that holds everything.
  const page =
    '<div style="background-color: rgb(250, 247, 242)">' +
    '<div style="background-color: rgb(30, 41, 59)"><h1 style="font-size: 32px">Growing Together</h1></div>' +
    '<div style="background-color: rgb(255, 253, 249); border: 1px solid rgb(232, 223, 211)">' +
    Array.from({ length: 6 }, (_, i) => para(i + 1)).join("") +
    "<table><tr><td><p>A table cell paragraph that is long enough.</p></td></tr></table>" +
    "</div></div>";

  it("tacks each word onto the end of a different paragraph, spread out", () => {
    for (let pick = 0; pick < 4; pick++) {
      const out = injectMagicWordsHtml(page, ["Magic word 1 of 2 is Growth", "Magic word 2 of 2 is Better"], (n, i) => (pick + i) % n);
      expect(out).not.toContain("<div>Magic word");
      const a = out.indexOf(" Magic word 1 of 2 is Growth</p>");
      const b = out.indexOf(" Magic word 2 of 2 is Better</p>");
      expect(a).toBeGreaterThan(0);
      expect(b).toBeGreaterThan(a);
      // Not in the same paragraph, and not in the table.
      expect(out.slice(a, b)).toContain("</p>");
      expect(b).toBeLessThan(out.indexOf("<table>"));
      expect(out.replace(" Magic word 1 of 2 is Growth", "").replace(" Magic word 2 of 2 is Better", "")).toBe(page);
    }
  });

  it("puts a single word in a paragraph in the latter part too", () => {
    const out = injectMagicWordHtml(page, "Magic word is Better", () => 0);
    const at = out.indexOf(" Magic word is Better</p>");
    expect(at).toBeGreaterThan(out.indexOf("Paragraph 3"));
  });

  it("skips paragraphs too short to hide a word in", () => {
    const out = injectMagicWordHtml("<p>Hi</p><p>Short</p>", "MW", () => 0);
    expect(out).toBe("<p>Hi</p><p>Short</p><div>MW</div>");
  });
});
