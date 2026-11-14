// Magic words for broadcasts. A broadcast can have several; they're stored
// together in the existing broadcasts.magic_word column, comma-separated
// ("pineapple, mango"), so a one-word broadcast is stored exactly as before.
// A VA must enter every word (any order, any capitalisation) to acknowledge.

/** The words in a stored magic_word value (or a VA's entry), trimmed, blanks and repeats dropped. */
export function parseMagicWords(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const words: string[] = [];
  for (const part of raw.split(",")) {
    const word = part.trim();
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    words.push(word);
  }
  return words;
}

/** Value to store in magic_word for these words; null when there are none. */
export function serializeMagicWords(words: string[]): string | null {
  const clean = parseMagicWords(words.join(","));
  return clean.length ? clean.join(", ") : null;
}

/** Whether `entered` contains every expected word. True when nothing is expected. */
export function magicWordsMatch(expected: string | null | undefined, entered: string | null | undefined): boolean {
  const want = parseMagicWords(expected).map((w) => w.toLowerCase());
  if (want.length === 0) return true;
  const got = new Set(parseMagicWords(entered).map((w) => w.toLowerCase()));
  return want.every((w) => got.has(w));
}

/** The line shown in the message for word `index` of `total`, in the portal's wording. */
export function magicWordLabel(word: string, index: number, total: number): string {
  return total > 1 ? `Magic word ${index + 1} of ${total} is ${word}` : `Magic word is ${word}`;
}

// ─── Chosen placement ────────────────────────────────────────────
// The admin can mark exactly where a word goes by putting a marker such as
// {{magic word 2}} in the message ("Place here" in the editor does this). The
// marker is plain text in the stored body, so no extra column is needed. Words
// without a marker are placed automatically.

const TOKEN_RE = /\{\{\s*magic\s*word\s*(\d*)\s*\}\}/gi;

/** The marker for word `index` (0-based). */
export function magicWordToken(index: number): string {
  return `{{magic word ${index + 1}}}`;
}

/** 0-based word index a marker refers to; a bare {{magic word}} means the first word. */
function tokenIndex(digits: string): number {
  return digits ? parseInt(digits, 10) - 1 : 0;
}

/** Whether the body has a marker for word `index`. */
export function hasMagicWordToken(body: string, index: number): boolean {
  for (const m of body.matchAll(TOKEN_RE)) if (tokenIndex(m[1]) === index) return true;
  return false;
}

/** Removes the markers for word `index`. */
export function removeMagicWordToken(body: string, index: number): string {
  return body.replace(TOKEN_RE, (all, digits: string) => (tokenIndex(digits) === index ? "" : all));
}

/** After word `index` is deleted: drops its markers and shifts later words' markers down by one. */
export function removeMagicWordAndRenumber(body: string, index: number): string {
  return body.replace(TOKEN_RE, (all, digits: string) => {
    const i = tokenIndex(digits);
    if (i === index) return "";
    return i > index ? magicWordToken(i - 1) : all;
  });
}

/**
 * Replaces each word's first marker with its line (already escaped for HTML
 * when `text` is HTML) and drops every other marker. `placed[i]` says whether
 * word i had a marker.
 */
export function fillMagicWordTokens(text: string, lines: string[]): { text: string; placed: boolean[] } {
  const placed = lines.map(() => false);
  const out = text.replace(TOKEN_RE, (_all, digits: string) => {
    const i = tokenIndex(digits);
    if (i < 0 || i >= lines.length || placed[i]) return "";
    placed[i] = true;
    return lines[i];
  });
  return { text: out, placed };
}
