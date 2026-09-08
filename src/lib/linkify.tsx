import type { ReactNode } from "react";

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
// A URL glued straight into a sentence ("check this out: https://x.com/y.")
// tends to drag trailing punctuation along with it — split that back off so
// the link itself doesn't end in a period, comma, or closing bracket that was
// never part of it.
const URL_TRAILING_PUNCTUATION = /[.,!?;:)\]"']+$/;

/**
 * Turns any bare https:// URL sitting inside plain text into a real link —
 * for text someone typed a link into directly, as opposed to a dedicated
 * Link field that's already an anchor.
 */
export function linkifyText(
  text: string,
  linkClassName = "text-terracotta underline hover:no-underline break-all"
): ReactNode {
  const parts = text.split(URL_PATTERN);
  return parts.map((part, i) => {
    if (i % 2 === 0) return part;
    const trailingMatch = part.match(URL_TRAILING_PUNCTUATION);
    const trailing = trailingMatch ? trailingMatch[0] : "";
    const url = trailing ? part.slice(0, -trailing.length) : part;
    return (
      <span key={i}>
        <a href={url} target="_blank" rel="noreferrer" className={linkClassName}>
          {url}
        </a>
        {trailing}
      </span>
    );
  });
}
