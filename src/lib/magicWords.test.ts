import { describe, expect, it } from "vitest";
import { magicWordLabel, magicWordsMatch, parseMagicWords, serializeMagicWords } from "./magicWords";
import { injectMagicWordsHtml, renderBroadcastHtml } from "./richText";

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
    for (const l of lines) stripped = stripped.replace(`<div><b>${l}</b></div>`, "");
    expect(stripped).toBe(html);
  });

  it("appends what doesn't fit in a message without boundaries", () => {
    expect(injectMagicWordsHtml("<b>short</b>", ["A", "B"], () => 0)).toBe("<b>short</b><div><b>A</b></div><div><b>B</b></div>");
  });

  it("works on plain-text memos", () => {
    const out = injectMagicWordsHtml(renderBroadcastHtml("one\ntwo\nthree\nfour"), ["X", "Y"], () => 0);
    expect(out.indexOf("X")).toBeLessThan(out.indexOf("Y"));
    expect(out).toContain("<div><b>X</b></div>");
  });
});
