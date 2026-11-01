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
  "p", "div", "br", "ul", "ol", "li", "h1", "h2", "h3", "blockquote", "a", "img",
]);

const VOID_TAGS = new Set(["br", "img"]);

/** Sizes an inline image can be set to in the editor, as a share of the message width. */
export const IMAGE_SIZES = {
  small: { label: "Small", width: "33%" },
  medium: { label: "Medium", width: "50%" },
  large: { label: "Large", width: "75%" },
} as const;

export type ImageSize = keyof typeof IMAGE_SIZES;

const RICH_TAG_RE =
  /<(p|div|br|b|strong|i|em|u|s|strike|mark|span|font|a|img|ul|ol|li|h[1-3]|blockquote)\b[^>]*>/i;

/** Tailwind classes for a container that renders sanitized broadcast HTML. */
export const RICH_TEXT_CLASSES =
  "[&_a]:text-terracotta [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:text-sm [&_h1]:font-bold [&_h2]:text-[13px] [&_h2]:font-bold [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-sand [&_blockquote]:pl-3 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-1 [&_img]:inline-block [&_img]:align-middle [&_img[data-selected]]:outline-2 [&_img[data-selected]]:outline-terracotta";

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
    .replace(/<\/(p|div|li|h[1-3]|blockquote)>/gi, "\n")
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

/** Keep only color / background-color from an inline style attribute. */
function safeStyle(style: string): string {
  const kept: string[] = [];
  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if ((prop === "background-color" || prop === "color") && COLOR_VALUE_RE.test(value)) {
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

function rebuildTag(tag: string, rawAttrs: string): string {
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
  }

  if (tag !== "img" && attrs.style) {
    const style = safeStyle(attrs.style);
    if (style) out.push(`style="${escapeHtml(style)}"`);
  }

  return `<${tag}${out.length ? " " + out.join(" ") : ""}>`;
}

/** Allowlist sanitizer: unknown tags are dropped (their text kept), attributes filtered. */
export function sanitizeRichHtml(html: string): string {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|template)\b[\s\S]*?<\/\1\s*>/gi, "");

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
      result += rebuildTag(tag, m[3]);
    }
  }
  result += cleaned.slice(last).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return result;
}

/**
 * Insert a "Magic word" line into rich HTML at a top-level boundary in the
 * latter 40% of the body. `pick` chooses among the candidate slots.
 */
export function injectMagicWordHtml(
  html: string,
  injection: string,
  pick: (slotCount: number) => number
): string {
  const line = `<div><b>${escapeHtml(injection)}</b></div>`;

  // Top-level boundaries: after a top-level <br>, or after a closing tag that returns to depth 0.
  const boundaries: number[] = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const tag = m[2].toLowerCase();
    if (VOID_TAGS.has(tag)) {
      if (depth === 0 && tag === "br") boundaries.push(tagRe.lastIndex);
      continue;
    }
    if (m[1]) {
      depth = Math.max(0, depth - 1);
      if (depth === 0) boundaries.push(tagRe.lastIndex);
    } else {
      depth++;
    }
  }

  const minPos = Math.floor(html.length * 0.6);
  const slots = boundaries.filter((b) => b >= minPos && b < html.length);
  if (slots.length === 0) return html + line;
  const at = slots[Math.min(slots.length - 1, Math.max(0, pick(slots.length)))];
  return html.slice(0, at) + line + html.slice(at);
}

/** The single entry point for displaying a broadcast body as safe HTML. */
export function renderBroadcastHtml(body: string): string {
  return sanitizeRichHtml(isRichHtml(body) ? body : plainToHtml(body));
}
