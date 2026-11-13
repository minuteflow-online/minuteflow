// Browser-only: turns an uploaded .html page that's styled with a <style>
// block / CSS classes into HTML whose look is carried by inline style=""
// attributes — the only styling the broadcast sanitizer keeps.
//
// The page is laid out in a hidden, sandboxed iframe (scripts never run).
// For every element, the properties that some CSS rule (or its own style
// attribute) sets on it are copied inline. Values come from the browser's
// computed style, so CSS variables and inherited units are already resolved;
// sizes that were written as %, auto or em keep their written form so the
// layout still fits the narrower portal card.

const LAYOUT_PROPS = new Set([
  "width", "max-width", "min-width", "height", "min-height",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
]);

// Containers the sanitizer doesn't know, renamed to <div> so their styles survive.
const RENAME_TO_DIV = new Set([
  "header", "footer", "section", "article", "main", "nav", "aside", "figure", "figcaption",
  "h5", "h6",
]);

const LAYOUT_WIDTH = 760;

/** Properties declared on `el` by the page's stylesheets or its own style attribute. */
function declaredProps(el: Element, rules: CSSStyleRule[]): Map<string, string> {
  const props = new Map<string, string>();
  const take = (style: CSSStyleDeclaration) => {
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      props.set(prop, style.getPropertyValue(prop));
    }
  };
  for (const rule of rules) {
    try {
      if (el.matches(rule.selectorText)) take(rule.style);
    } catch {
      // Selector the browser can't match against (e.g. ::before) — skip it.
    }
  }
  const own = (el as HTMLElement).style;
  if (own) take(own);
  return props;
}

/** Style rules that apply at the hidden layout width, in source order. */
function collectRules(doc: Document, win: Window): CSSStyleRule[] {
  const rules: CSSStyleRule[] = [];
  const walk = (list: CSSRuleList) => {
    // Rules belong to the iframe's window, so check `type` rather than instanceof.
    for (const rule of Array.from(list)) {
      if (rule.type === 1 /* STYLE_RULE */) {
        rules.push(rule as CSSStyleRule);
      } else if (rule.type === 4 /* MEDIA_RULE */) {
        const media = rule as CSSMediaRule;
        if (win.matchMedia(media.conditionText).matches) walk(media.cssRules);
      } else if ("cssRules" in rule) {
        // @supports, @layer and similar groupings
        try {
          walk((rule as CSSGroupingRule).cssRules);
        } catch {
          /* unreadable */
        }
      }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {
      // A stylesheet from another site (e.g. a font CSS link) can't be read — fine.
    }
  }
  return rules;
}

function styleFor(el: Element, win: Window, rules: CSSStyleRule[]): string {
  const declared = declaredProps(el, rules);
  if (declared.size === 0) return "";
  const computed = win.getComputedStyle(el);
  const out: string[] = [];
  for (const [prop, written] of declared) {
    if (prop.startsWith("--")) continue; // custom properties are resolved below
    let value = computed.getPropertyValue(prop).trim();
    // Keep fluid sizes as written (e.g. 100%, auto, 2em) instead of the px they resolved to here.
    if (LAYOUT_PROPS.has(prop) && written && !/var\(/i.test(written) && /%|auto|em\b|rem\b|vw|fit-content|max-content/i.test(written)) {
      value = written.trim();
    }
    if (value) out.push(`${prop}: ${value}`);
  }
  return out.join("; ");
}

/**
 * Inline a full uploaded page's CSS onto its elements and return the message
 * HTML (the page body, wrapped in a div that carries the body/html styles).
 * Resolves to the input unchanged if the page can't be laid out.
 */
export async function inlineHtmlFileStyles(text: string): Promise<string> {
  if (typeof document === "undefined") return text;

  const iframe = document.createElement("iframe");
  // allow-same-origin lets us read the laid-out page; without allow-scripts nothing in it runs.
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.style.cssText = `position: fixed; left: -10000px; top: 0; width: ${LAYOUT_WIDTH}px; height: 800px; border: 0; visibility: hidden;`;
  document.body.appendChild(iframe);

  try {
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
      iframe.srcdoc = text;
      setTimeout(resolve, 3000); // a slow external font/stylesheet shouldn't hang the upload
    });
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc?.body) return text;

    const rules = collectRules(doc, win);
    const elements = [doc.documentElement, doc.body, ...Array.from(doc.body.querySelectorAll("*"))];
    const styles = new Map<Element, string>();
    for (const el of elements) styles.set(el, styleFor(el, win, rules));

    for (const el of Array.from(doc.body.querySelectorAll("*"))) {
      const style = styles.get(el);
      if (style) el.setAttribute("style", style);
      else el.removeAttribute("style");
    }
    // Rename unknown containers last (renaming replaces the node).
    for (const el of Array.from(doc.body.querySelectorAll("*"))) {
      if (!RENAME_TO_DIV.has(el.tagName.toLowerCase())) continue;
      const div = doc.createElement("div");
      for (const attr of Array.from(el.attributes)) div.setAttribute(attr.name, attr.value);
      while (el.firstChild) div.appendChild(el.firstChild);
      el.replaceWith(div);
    }

    // html + body styles (page background, base font, colour) go on one wrapper div.
    const wrapperStyle = [styles.get(doc.documentElement), styles.get(doc.body)]
      .filter(Boolean)
      .join("; ")
      .replace(/(^|;\s*)(margin-(top|right|bottom|left)|height|min-height|width|min-width):[^;]*/g, "")
      .replace(/^;\s*|;\s*$/g, "")
      .trim();
    const inner = doc.body.innerHTML.trim();
    return wrapperStyle ? `<div style="${wrapperStyle.replace(/"/g, "'")}">${inner}</div>` : inner;
  } catch {
    return text;
  } finally {
    iframe.remove();
  }
}
