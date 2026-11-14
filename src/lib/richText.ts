/**
 * Rich text for broadcasts.
 *
 * Bodies written with the rich editor are stored as HTML; older bodies are
 * plain text. Everything that displays a body (portal, admin list, email)
 * goes through `renderBroadcastHtml`, which converts plain text and runs an
 * allowlist sanitizer. The sanitizer is string-based so it works on the
 * server (email) as well as the browser.
 */

const ALLOWED_TAGS = new Set([
  "b", "strong", "i", "em", "u", "s", "strike", "mark", "span", "font",
  "p", "div", "br", "ul", "ol", "li", "h1", "h2", "h3", "h4", "blockquote", "a", "img",
  "hr", "table", "thead", "tbody", "tr", "th", "td",
]);

const VOID_TAGS = new Set(["br", "img", "hr"]);

/** Sizes an inline image can be set to in the editor, as a share of the message width. */
export const IMAGE_SIZES = {
  small: { label: "Small", width: "33%" },
  medium: { label: "Medium", width: "50%" },
  large: { label: "Large", width: "75%" },
} as const;

export type ImageSize = keyof typeof IMAGE_SIZES;

const RICH_TAG_RE =
  /<(p|div|br|b|strong|i|em|u|s|strike|mark|span|font|a|img|ul|ol|li|h[1-4]|blockquote|hr|table|thead|tbody|tr|th|td)\b[^>]*>/i;

/** Tailwind classes for a container that renders sanitized broadcast HTML. */
export const RICH_TEXT_CLASSES =
  "[&_a]:text-terracotta [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:text-sm [&_h1]:font-bold [&_h2]:text-[13px] [&_h2]:font-bold [&_h3]:font-semibold [&_h4]:font-semibold [&_hr]:border-sand [&_hr]:my-2 [&_table]:border-collapse [&_th]:border [&_th]:border-sand [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-sand [&_td]:px-2 [&_td]:py-1 [&_blockquote]:border-l-2 [&_blockquote]:border-sand [&_blockquote]:pl-3 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-1 [&_img]:inline-block [&_img]:align-middle [&_img[data-selected]]:outline-2 [&_img[data-selected]]:outline-terracotta";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function isRichHtml(body: string): boolean {
  return RICH_TAG_RE.test(body);
}

export function plainToHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

/** Editor output with no tags at all would read as plain text — wrap it. */
export function ensureRichHtml(html: string): string {
  // data-selected is the editor's transient image-selection marker; never save it.
  html = html.replace(/\sdata-selected(="")?/g, "");
  return isRichHtml(html) ? html : `<div>${html}</div>`;
}

/** Visible text of a body, for length checks and "is it empty" checks. */
export function richTextToPlain(body: string): string {
  if (!isRichHtml(body)) return body;
  return body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-4]|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

export function isRichEmpty(body: string): boolean {
  return !richTextToPlain(body).trim() && !/<img\b/i.test(body);
}

function safeUrl(raw: string, allowMailto: boolean): string | null {
  const url = raw.trim().replace(/&amp;/g, "&");
  if (/^https?:\/\//i.test(url)) return url;
  if (allowMailto && /^mailto:/i.test(url)) return url;
  return null;
}

const COLOR_VALUE_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;
const TEXT_ALIGN_RE = /^(left|right|center|justify)$/i;
const LIST_STYLE_RE = /^(decimal|lower-alpha|upper-alpha|lower-roman|upper-roman)$/i;

// Layout/typography properties kept only in "design" mode (HTML view and
// display), never on paste: pasted Google Docs carry font sizes and margins
// that would otherwise override the message's own look.
const DESIGN_PROPS = new Set([
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-color", "border-width", "border-style", "border-radius",
  "font-size", "font-weight", "font-style", "text-decoration", "line-height",
  "width", "max-width", "min-width", "height", "min-height", "box-sizing",
  // Longhands, as an uploaded page's stylesheet is inlined from computed styles.
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  "text-decoration-line", "text-decoration-color", "text-decoration-style",
  "letter-spacing", "text-transform", "vertical-align",
  "align-items", "justify-content", "gap", "row-gap", "column-gap", "flex-direction", "flex-wrap",
]);
// Lengths, keywords and colours only — no url(), expression(), var() or escapes.
const DESIGN_VALUE_RE = /^[#a-z0-9\s.,%()-]+$/i;
const DESIGN_VALUE_BLOCK_RE = /url|expression|javascript|var\(|image|attr\(/i;
const DISPLAY_RE = /^(block|inline|inline-block|flex|inline-flex|none)$/i;
const FONT_FAMILY_RE = /^[a-z0-9\s,"'-]+$/i;
const GRADIENT_RE = /^(linear|radial)-gradient\([#a-z0-9\s.,%()-]+\)$/i;

function decodeAttrEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
}

export type SanitizeMode = "design" | "paste";

/** Keep only safe properties from an inline style attribute. */
function safeStyle(style: string, mode: SanitizeMode): string {
  const kept: string[] = [];
  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if ((prop === "background-color" || prop === "color") && COLOR_VALUE_RE.test(value)) {
      kept.push(`${prop}: ${value}`);
    } else if (prop === "text-align" && TEXT_ALIGN_RE.test(value)) {
      kept.push(`${prop}: ${value}`);
    } else if (prop === "list-style-type" && LIST_STYLE_RE.test(value)) {
      kept.push(`${prop}: ${value}`);
    } else if (mode !== "design") {
      continue;
    } else if (prop === "display") {
      if (DISPLAY_RE.test(value)) kept.push(`${prop}: ${value}`);
    } else if (prop === "font-family") {
      if (value.length <= 120 && FONT_FAMILY_RE.test(value)) kept.push(`${prop}: ${value}`);
    } else if (prop === "background-image") {
      if (value.length <= 300 && GRADIENT_RE.test(value) && !DESIGN_VALUE_BLOCK_RE.test(value)) kept.push(`${prop}: ${value}`);
    } else if (
      DESIGN_PROPS.has(prop) &&
      value.length <= 80 &&
      DESIGN_VALUE_RE.test(value) &&
      !DESIGN_VALUE_BLOCK_RE.test(value)
    ) {
      kept.push(`${prop}: ${value}`);
    }
  }
  return kept.join("; ");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z-:]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

function rebuildTag(tag: string, rawAttrs: string, mode: SanitizeMode): string {
  const attrs = parseAttrs(rawAttrs);
  const out: string[] = [];

  if (tag === "a") {
    const href = attrs.href ? safeUrl(attrs.href, true) : null;
    if (href) out.push(`href="${escapeHtml(href)}"`);
    out.push('target="_blank"', 'rel="noopener noreferrer"');
  } else if (tag === "img") {
    const src = attrs.src ? safeUrl(attrs.src, false) : null;
    if (!src) return "";
    out.push(`src="${escapeHtml(src)}"`);
    if (attrs.alt) out.push(`alt="${escapeHtml(attrs.alt)}"`);
    // Size comes only from data-size (never a raw style), rendered inline so it also holds in email.
    const size = attrs["data-size"] as ImageSize | undefined;
    if (size && size in IMAGE_SIZES) {
      out.push(`data-size="${size}"`, `style="width: ${IMAGE_SIZES[size].width}; max-width: 100%; height: auto;"`);
    } else {
      out.push('style="max-width: 100%; height: auto;"');
    }
  } else if (tag === "font") {
    // Some browsers emit <font> for highlight; keep only its color.
    if (attrs.color && COLOR_VALUE_RE.test(attrs.color)) out.push(`color="${escapeHtml(attrs.color)}"`);
  } else if (tag === "td" || tag === "th") {
    for (const span of ["colspan", "rowspan"]) {
      if (/^\d{1,2}$/.test(attrs[span] ?? "")) out.push(`${span}="${attrs[span]}"`);
    }
  }

  if (tag !== "img" && attrs.style) {
    // Decode first: a quoted font name arrives as &quot;…&quot;, whose ";" would split the declaration.
    const style = safeStyle(decodeAttrEntities(attrs.style), mode);
    if (style) out.push(`style="${escapeHtml(style)}"`);
  }

  return `<${tag}${out.length ? " " + out.join(" ") : ""}>`;
}

/**
 * Allowlist sanitizer: unknown tags are dropped (their text kept), attributes filtered.
 * "design" (default) also keeps layout styles such as padding, borders and font size;
 * "paste" keeps only colour, highlight, alignment and list style.
 */
export function sanitizeRichHtml(html: string, mode: SanitizeMode = "design"): string {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, "")
    // head/title too: a whole pasted HTML page shouldn't show its <title> text.
    .replace(/<(script|style|iframe|object|embed|template|head|title)\b[\s\S]*?<\/\1\s*>/gi, "");

  let result = "";
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(cleaned))) {
    result += cleaned.slice(last, m.index).replace(/</g, "&lt;").replace(/>/g, "&gt;");
    last = tagRe.lastIndex;
    const tag = m[2].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (m[1]) {
      if (!VOID_TAGS.has(tag)) result += `</${tag}>`;
    } else {
      result += rebuildTag(tag, m[3], mode);
    }
  }
  result += cleaned.slice(last).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return result;
}

/**
 * Insert a "Magic word" sentence into rich HTML in the latter 40% of the body.
 * It's added to the end of an existing regular paragraph so it reads like the
 * rest of the text; without one it goes in as its own line at a top-level
 * boundary. `pick` chooses among the candidate slots.
 */
export function injectMagicWordHtml(
  html: string,
  injection: string,
  pick: (slotCount: number) => number
): string {
  const minPos = Math.floor(html.length * 0.6);
  const paragraphs = paragraphEnds(html).map((p) => p.end).filter((p) => p >= minPos);
  if (paragraphs.length) {
    const at = paragraphs[Math.min(paragraphs.length - 1, Math.max(0, pick(paragraphs.length)))];
    return html.slice(0, at) + magicSentence(injection) + html.slice(at);
  }
  const line = magicLine(injection);
  const slots = topLevelBoundaries(html).filter((b) => b >= minPos && b < html.length);
  if (slots.length === 0) return html + line;
  const at = slots[Math.min(slots.length - 1, Math.max(0, pick(slots.length)))];
  return html.slice(0, at) + line + html.slice(at);
}

/**
 * Several magic words. The last one goes at the end of the last regular
 * paragraph inside the message's last box (a card or callout with a background
 * or border), or the last regular paragraph when there's no box. The others are
 * spread over the text before it, one per equal stretch, so finding them all
 * means reading the whole message. Words only go at the end of regular-size,
 * non-bold paragraphs (or, in a body with none, as their own line at a
 * top-level boundary). A stretch with no free spot borrows the next free one
 * after it; past the last, words are appended.
 * `pick(slotCount, wordIndex)` chooses within a stretch.
 */
export function injectMagicWordsHtml(
  html: string,
  injections: string[],
  pick: (slotCount: number, wordIndex: number) => number
): string {
  const n = injections.length;
  if (n === 0) return html;
  const paragraphs = paragraphEnds(html);
  const inParagraphs = paragraphs.length > 0;
  const spots = inParagraphs ? paragraphs.map((p) => p.end) : topLevelBoundaries(html).filter((b) => b < html.length);
  const used = new Set<number>();
  const placements: { at: number; text: string; order: number }[] = [];
  const wrap = (injection: string) => (inParagraphs ? magicSentence(injection) : magicLine(injection));

  // The last word ends the last box's last paragraph; the rest share the text before it.
  let spreadEnd = html.length;
  let spreadCount = n;
  if (inParagraphs && n > 1) {
    const boxed = paragraphs.filter((p) => p.inBox);
    const pool = boxed.length ? boxed : paragraphs;
    const last = pool[pool.length - 1].end;
    used.add(last);
    placements.push({ at: last, text: wrap(injections[n - 1]), order: n - 1 });
    spreadEnd = last;
    spreadCount = n - 1;
  }

  for (let i = 0; i < spreadCount; i++) {
    const start = Math.floor((spreadEnd * i) / spreadCount);
    const end = Math.floor((spreadEnd * (i + 1)) / spreadCount);
    let slots = spots.filter((b) => b >= start && b < end && !used.has(b));
    if (slots.length === 0) slots = spots.filter((b) => b >= start && !used.has(b)).slice(0, 1);
    if (slots.length === 0) {
      placements.push({ at: html.length, text: magicLine(injections[i]), order: i });
      continue;
    }
    const at = slots[Math.min(slots.length - 1, Math.max(0, pick(slots.length, i)))];
    used.add(at);
    placements.push({ at, text: wrap(injections[i]), order: i });
  }

  // Insert from the end so earlier positions stay valid; same spot keeps word order.
  placements.sort((a, b) => b.at - a.at || b.order - a.order);
  let out = html;
  for (const p of placements) out = out.slice(0, p.at) + p.text + out.slice(p.at);
  return out;
}

/** Plain text, styled like whatever it lands in, so it blends into the message. */
function magicLine(injection: string): string {
  return `<div>${escapeHtml(injection)}</div>`;
}

function magicSentence(injection: string): string {
  return ` ${escapeHtml(injection)}`;
}

/** Shortest paragraph (in visible characters) a magic word sentence is added to. */
const MIN_PARAGRAPH_CHARS = 30;

/** How much larger than the regular text a paragraph may be and still count as regular. */
const REGULAR_SIZE_SLACK_PX = 1.5;

const INLINE_TAGS = new Set(["b", "strong", "i", "em", "u", "s", "strike", "mark", "span", "font", "a", "br", "img"]);

/** font-size in px from a style attribute: undefined if not set, null if not in px/em/rem. */
function styleFontSize(style: string): number | null | undefined {
  const m = style.match(/(?:^|;)\s*font-size\s*:\s*([^;]+)/i);
  if (!m) return undefined;
  const v = m[1].trim().match(/^([\d.]+)(px|em|rem)$/i);
  if (!v) return null;
  return v[2].toLowerCase() === "px" ? parseFloat(v[1]) : parseFloat(v[1]) * 16;
}

/** Whether a style attribute makes text bold: undefined if it doesn't set a weight. */
function styleBold(style: string): boolean | undefined {
  const m = style.match(/(?:^|;)\s*font-weight\s*:\s*([^;]+)/i);
  if (!m) return undefined;
  const v = m[1].trim().toLowerCase();
  return v === "bold" || v === "bolder" || (/^\d+$/.test(v) && parseInt(v, 10) >= 600);
}

/**
 * Whether a style (or a tag's raw attributes) gives an element a background or
 * a border, i.e. makes it a card, banner or callout. Matches property names, so
 * `box-sizing: border-box` and `border-radius` alone don't count.
 */
function isBoxStyle(style: string): boolean {
  return /(?:^|[;"'\s])(background(?:-color|-image)?|border(?:-(?:top|right|bottom|left))?(?:-(?:width|style|color))?)\s*:/i.test(style);
}

type ParagraphEnd = { end: number; inBox: boolean };
type TextContext = { size: number | null | undefined; bold: boolean; inTable: boolean; inBox: boolean };

/**
 * Where a magic word sentence can be tacked on: the end of each paragraph with
 * real text — a <p>, or text written straight inside a <div> — outside tables,
 * not bold, and at about the message's regular text size, so it never lands in
 * a big bold callout or pull quote. `inBox` marks paragraphs inside a card or
 * callout (a div with a background or border; the outermost div is the page
 * wrapper and doesn't count).
 */
function paragraphEnds(html: string): ParagraphEnd[] {
  type Frame = { tag: string; size?: number | null; bold?: boolean; box: boolean };
  const stack: Frame[] = [];
  const found: { end: number; size: number | null | undefined; chars: number; inBox: boolean }[] = [];
  const inherited = <K extends "size" | "bold">(key: K): Frame[K] | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i][key] !== undefined) return stack[i][key];
    return undefined;
  };
  const nearestBlock = (): Frame | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) if (!INLINE_TAGS.has(stack[i].tag)) return stack[i];
    return undefined;
  };
  const context = (): TextContext => ({
    size: inherited("size"),
    bold: inherited("bold") === true,
    inTable: stack.some((f) => f.tag === "table"),
    inBox: stack.some((f) => f.box),
  });
  const visible = (s: string) =>
    s.replace(/<[^>]*>/g, "").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
  const consider = (start: number, end: number, ctx: TextContext) => {
    const chars = visible(html.slice(start, end)).length;
    if (!ctx.inTable && !ctx.bold && chars >= MIN_PARAGRAPH_CHARS) {
      found.push({ end, size: ctx.size, chars, inBox: ctx.inBox });
    }
  };

  // A run of text written directly inside a div (not wrapped in <p>).
  let run: { start: number; ctx: TextContext } | null = null;
  const flushRun = (at: number) => {
    if (run) consider(run.start, at, run.ctx);
    run = null;
  };
  const startRun = (at: number) => {
    if (!run && nearestBlock()?.tag === "div") run = { start: at, ctx: context() };
  };

  let pOpen: { start: number; ctx: TextContext } | null = null;
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let textFrom = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    if (html.slice(textFrom, m.index).trim()) startRun(textFrom);
    textFrom = tagRe.lastIndex;
    const tag = m[2].toLowerCase();
    if (INLINE_TAGS.has(tag)) {
      if (!m[1]) startRun(m.index);
    } else {
      flushRun(m.index);
    }
    if (VOID_TAGS.has(tag)) continue;
    if (!m[1]) {
      const style = (m[3].match(/style\s*=\s*"([^"]*)"/i) ?? m[3].match(/style\s*=\s*'([^']*)'/i))?.[1] ?? "";
      const box = tag === "div" && stack.length > 0 && isBoxStyle(style);
      stack.push({ tag, size: styleFontSize(style), bold: styleBold(style), box });
      if (tag === "p") pOpen = { start: tagRe.lastIndex, ctx: context() };
      continue;
    }
    // Closing tag: pop back to the matching open tag.
    const idx = stack.map((f) => f.tag).lastIndexOf(tag);
    if (idx >= 0) stack.length = idx;
    if (tag === "p" && pOpen) {
      consider(pOpen.start, m.index, pOpen.ctx);
      pOpen = null;
    }
  }

  // The regular text size is the one most of the paragraph text is set in.
  const bySize = new Map<number, number>();
  for (const p of found) {
    const key = typeof p.size === "number" ? p.size : -1;
    bySize.set(key, (bySize.get(key) ?? 0) + p.chars);
  }
  let regular = -1;
  let most = -1;
  for (const [size, chars] of bySize) if (chars > most) [regular, most] = [size, chars];
  // With no set size for most text, the app's own size applies; allow ordinary sizes only.
  const maxSize = regular === -1 ? 16 : regular + REGULAR_SIZE_SLACK_PX;
  return found
    .filter((p) => typeof p.size !== "number" || p.size <= maxSize)
    .sort((a, b) => a.end - b.end)
    .map(({ end, inBox }) => ({ end, inBox }));
}

const BLOCK_TAGS = new Set(["p", "div", "ul", "ol", "h1", "h2", "h3", "h4", "blockquote", "table"]);

/**
 * Where a magic word line can go without landing inside something:
 * - at the top level, after a <br>/<hr> or any closing tag (the original rule), and
 * - inside plain wrapper <div>s (no background or border — an uploaded page's
 *   layout containers; the outermost div may have a background), after a block
 *   element or <br>/<hr>.
 * Never inside a coloured/bordered card, a list, a table or a paragraph.
 */
function topLevelBoundaries(html: string): number[] {
  const boundaries: number[] = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  // Each open element, and whether a line may be placed directly inside it.
  const stack: boolean[] = [];
  const insidePlainWrappers = () => stack.every(Boolean);
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const tag = m[2].toLowerCase();
    if (VOID_TAGS.has(tag)) {
      if ((tag === "br" || tag === "hr") && insidePlainWrappers()) boundaries.push(tagRe.lastIndex);
      continue;
    }
    if (m[1]) {
      stack.pop();
      if (stack.length === 0 || (BLOCK_TAGS.has(tag) && insidePlainWrappers())) boundaries.push(tagRe.lastIndex);
    } else {
      // A background or border marks a card or banner (the line could vanish on a
      // dark header). The outermost div is exempt: on an uploaded page it's the
      // wrapper carrying the page background.
      stack.push(tag === "div" && (stack.length === 0 || !isBoxStyle(m[3])));
    }
  }
  return boundaries;
}

/** Largest .html file the editor will load (a message, not a website). */
export const MAX_HTML_FILE_BYTES = 1024 * 1024;

/**
 * The part of an uploaded .html file that becomes the message: the inside of
 * <body> when the file is a whole page, otherwise the file as-is. It still goes
 * through the sanitizer everywhere it's shown.
 */
export function htmlFileToMessage(text: string): string {
  const body = text.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  const inner = body
    ? body[1]
    : text
        .replace(/<!doctype[^>]*>/gi, "")
        .replace(/<head\b[\s\S]*?<\/head\s*>/gi, "")
        .replace(/<\/?html\b[^>]*>/gi, "");
  return inner.trim();
}

/** The single entry point for displaying a broadcast body as safe HTML. */
export function renderBroadcastHtml(body: string): string {
  return sanitizeRichHtml(isRichHtml(body) ? body : plainToHtml(body));
}
