// Ported from src/lib/linkify.tsx, with mention highlighting added
// (DashboardMessagePanel.tsx's own local highlightMentions/linkifyText,
// PR #253) folded in here instead of duplicated — desktop only has the one
// copy of this, unlike web's separate lib + component-local versions.
import type { ReactNode } from "react";

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
// A URL glued straight into a sentence ("check this out: https://x.com/y.")
// tends to drag trailing punctuation along with it — split that back off so
// the link itself doesn't end in a period, comma, or closing bracket that was
// never part of it.
const URL_TRAILING_PUNCTUATION = /[.,!?;:)\]"']+$/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turns "@Full Name", "@everyone" or "@all" into a highlighted span —
 * matched against actual team member names, so a stray "@" in ordinary text
 * is never mistaken for a mention.
 */
function highlightMentions(text: string, knownNames: string[]): ReactNode {
  if (knownNames.length === 0) return text;
  const names = Array.from(new Set([...knownNames, "everyone", "all"]));
  const pattern = names.slice().sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
  const re = new RegExp(`@(${pattern})\\b`, "gi");
  const parts = text.split(re);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="text-slate-blue font-semibold">{`@${part}`}</span>
    ) : (
      part
    )
  );
}

/**
 * Turns any bare https:// URL sitting inside plain text into a real link —
 * for text someone typed a link into directly, as opposed to a dedicated
 * Link field that's already an anchor — and any @mention of a real team
 * member into a highlighted span. `mentionNames` is optional so callers with
 * no member list handy still get URL-linkifying as before.
 */
export function linkifyText(
  text: string,
  mentionNames: string[] = [],
  linkClassName = "text-terracotta underline hover:no-underline break-all"
): ReactNode {
  const parts = text.split(URL_PATTERN);
  return parts.map((part, i) => {
    if (i % 2 === 0) return <span key={i}>{highlightMentions(part, mentionNames)}</span>;
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
