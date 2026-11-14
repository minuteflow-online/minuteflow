import { describe, expect, it } from "vitest";
import { broadcastDisplayHtml } from "./broadcastDisplay";
import {
  fillMagicWordTokens,
  hasMagicWordToken,
  magicWordToken,
  removeMagicWordAndRenumber,
  removeMagicWordToken,
} from "./magicWords";
import { injectMagicWordsHtml } from "./richText";

const para = (t: string) => `<p>${t} — with enough ordinary words to hold a magic word.</p>`;

describe("magic word markers", () => {
  it("finds, removes and renumbers markers", () => {
    const body = `<p>a ${magicWordToken(0)}</p><p>b {{ Magic Word 2 }}</p><p>c {{magic word 3}}</p>`;
    expect(hasMagicWordToken(body, 1)).toBe(true);
    expect(hasMagicWordToken(body, 3)).toBe(false);
    expect(removeMagicWordToken(body, 1)).toBe(`<p>a {{magic word 1}}</p><p>b </p><p>c {{magic word 3}}</p>`);
    expect(removeMagicWordAndRenumber(body, 0)).toBe(`<p>a </p><p>b {{magic word 1}}</p><p>c {{magic word 2}}</p>`);
  });

  it("fills each word's first marker and drops the rest", () => {
    const out = fillMagicWordTokens("x {{magic word}} y {{magic word 1}} z {{magic word 9}}", ["ONE"]);
    expect(out.text).toBe("x ONE y  z ");
    expect(out.placed).toEqual([true]);
  });
});

describe("broadcastDisplayHtml", () => {
  const body = [para("One"), para("Two"), para("Three"), para("Four")].join("");

  it("puts a word exactly where its marker is, and places the others automatically", () => {
    const marked = body.replace("Two — with enough ordinary words to hold a magic word.", "Two {{magic word 2}} rest.");
    const out = broadcastDisplayHtml({ id: "abc", body: marked, magic_word: "alpha, beta, gamma" });
    expect(out).toContain("Two Magic word 2 of 3 is beta rest.");
    expect(out).toContain("Magic word 1 of 3 is alpha");
    expect(out).toContain("Magic word 3 of 3 is gamma");
    expect(out).not.toContain("{{");
  });

  it("escapes the word when it fills a marker", () => {
    const out = broadcastDisplayHtml({ id: "a", body: "<p>Here {{magic word}}</p>", magic_word: "<b>x</b>" });
    expect(out).toContain("Here Magic word is &lt;b&gt;x&lt;/b&gt;");
  });

  it("hides markers when the broadcast has no magic word", () => {
    expect(broadcastDisplayHtml({ id: "a", body: "<p>Hi {{magic word 1}}</p>", magic_word: null })).toBe("<p>Hi </p>");
  });

  it("works for a plain-text single-word memo", () => {
    const out = broadcastDisplayHtml({ id: "a", body: "first\n\nsecond {{magic word}}\n\nthird", magic_word: "kiwi" });
    expect(out).toContain("second Magic word is kiwi");
    const auto = broadcastDisplayHtml({ id: "a", body: "first\n\nsecond\n\nthird", magic_word: "kiwi" });
    expect(auto).toContain("Magic word is kiwi");
  });
});

describe("the last magic word goes in the last box", () => {
  const box = (inner: string) =>
    `<div style="background-color: rgb(255, 255, 255); border-left-width: 6px; font-size: 18px">${inner}</div>`;
  const page =
    '<div style="background-color: rgb(250, 246, 239); font-size: 17px"><div>' +
    [para("One"), para("Two"), para("Three"), para("Four")].join("") +
    box(
      "<strong>A bold lead-in sentence for the box.</strong> Then some regular words.\n" +
        "<p>There's an opportunity to:</p><ul><li>Share</li></ul>\n" +
        "That means setting a good example and being a great mentor.\n"
    ) +
    para("Remember to look at work") +
    para("Thank you for your hard work") +
    "</div></div>";

  it("ends the last box's loose closing text with the last word", () => {
    const out = injectMagicWordsHtml(page, ["W1", "W2", "W3"], () => 0);
    expect(out).toMatch(/great mentor\.\n W3<\/div>/);
    expect(out.indexOf("W1")).toBeLessThan(out.indexOf("W2"));
    expect(out.indexOf("W2")).toBeLessThan(out.indexOf("W3"));
    expect(out.indexOf("Thank you")).toBeGreaterThan(out.indexOf("W3"));
  });

  it("uses the last regular paragraph when there's no box", () => {
    const plain = [para("One"), para("Two"), para("Three")].join("");
    const out = injectMagicWordsHtml(plain, ["W1", "W2"], () => 0);
    expect(out).toContain("magic word. W2</p>");
    expect(out.indexOf("W2")).toBeGreaterThan(out.indexOf("Three"));
  });
});

describe("layout containers aren't boxes", () => {
  it("ignores box-sizing: border-box and border-radius on plain containers", () => {
    const page =
      '<div style="box-sizing: border-box; background-color: rgb(250, 246, 239); font-size: 17px">' +
      '<div style="box-sizing: border-box; max-width: 820px">' +
      '<div style="box-sizing: border-box; margin-top: 56px">' +
      para("One") + para("Two") +
      '<div style="box-sizing: border-box; background-color: rgb(255, 255, 255); border-left-width: 6px">' +
      "Loose closing text inside the card, long enough to use.</div>" +
      "</div>" +
      '<div style="box-sizing: border-box; margin-top: 56px; border-top-left-radius: 8px">' +
      para("Thank you for your hard work") +
      "</div></div></div>";
    const out = injectMagicWordsHtml(page, ["W1", "W2"], () => 0);
    expect(out).toContain("long enough to use. W2</div>");
    expect(out).not.toContain("hard work — with enough ordinary words to hold a magic word. W");
  });
});
