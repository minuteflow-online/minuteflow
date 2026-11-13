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
