import { fillMagicWordTokens, magicWordLabel, parseMagicWords } from "@/lib/magicWords";
import {
  escapeHtml,
  injectMagicWordHtml,
  injectMagicWordsHtml,
  isRichHtml,
  plainToHtml,
  renderBroadcastHtml,
  sanitizeRichHtml,
} from "@/lib/richText";

/**
 * Injects "Magic word is [word]" into a plain-text body as a paragraph after
 * the 60% mark. Position is deterministic per broadcast: uses the char code of
 * the last character of the id to pick which paragraph boundary (split on \n\n)
 * to insert after, within the latter 40% of the text.
 */
function injectMagicWordPlain(body: string, injection: string, broadcastId: string): string {
  const anchor = broadcastId.charCodeAt(broadcastId.length - 1); // 0–255

  // Try paragraph-aware insertion first
  const paragraphs = body.split("\n\n");
  if (paragraphs.length >= 2) {
    // Pick an insertion point in the latter 40% of paragraphs
    const minIdx = Math.ceil(paragraphs.length * 0.6);
    const range = paragraphs.length - minIdx; // how many slots available
    const offset = range > 0 ? anchor % range : 0;
    const insertAt = minIdx + offset; // insert AFTER this index
    return [...paragraphs.slice(0, insertAt), injection, ...paragraphs.slice(insertAt)].join("\n\n");
  }

  // Fallback: character-level insertion after the 60% mark
  const minPos = Math.floor(body.length * 0.6);
  const range = body.length - minPos;
  const insertPos = minPos + (range > 0 ? anchor % range : 0);
  return body.slice(0, insertPos) + "\n\n" + injection + "\n\n" + body.slice(insertPos);
}

type BroadcastBody = { id: string; body: string; magic_word: string | null | undefined };

interface MagicWordOptions {
  /** The line shown for word `index` of `total`. */
  label?: (word: string, index: number, total: number) => string;
  /** Chooses among `slotCount` candidate spots for word `index`. */
  pick?: (slotCount: number, index: number) => number;
  /** Places the single word's line in a plain-text (non-HTML) body. */
  placePlain?: (body: string, line: string) => string;
}

/**
 * A broadcast body as safe HTML with its magic words in it. A word goes where
 * the admin put its {{magic word N}} marker; words without one are placed
 * automatically. The portal, the admin list and the email all use this, so
 * the admin sees what VAs read.
 */
export function broadcastDisplayHtml(broadcast: BroadcastBody, options: MagicWordOptions = {}): string {
  const anchor = broadcast.id.charCodeAt(broadcast.id.length - 1);
  const label = options.label ?? magicWordLabel;
  const pick = options.pick ?? ((n: number, i: number) => (anchor + i) % n);
  const placePlain = options.placePlain ?? ((body: string, line: string) => injectMagicWordPlain(body, line, broadcast.id));

  const words = parseMagicWords(broadcast.magic_word);
  const lines = words.map((w, i) => label(w, i, words.length));
  const filled = fillMagicWordTokens(renderBroadcastHtml(broadcast.body), lines.map(escapeHtml));
  const rest = lines.filter((_, i) => !filled.placed[i]);
  if (rest.length === 0) return filled.text;

  if (words.length > 1) return injectMagicWordsHtml(filled.text, rest, pick);
  if (isRichHtml(broadcast.body)) return injectMagicWordHtml(filled.text, rest[0], (n) => pick(n, 0));
  // One word in a plain-text body: the original line-based placement (any stray markers dropped first).
  const plain = fillMagicWordTokens(broadcast.body, []).text;
  return sanitizeRichHtml(plainToHtml(placePlain(plain, rest[0])));
}
