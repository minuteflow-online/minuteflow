"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import BroadcastCopyLinkButton from "@/components/BroadcastCopyLinkButton";
import { broadcastPortalPath } from "@/lib/broadcasts";
import { memoChatPath } from "@/lib/memoChat";
import {
  injectMagicWordHtml,
  isRichHtml,
  plainToHtml,
  renderBroadcastHtml,
  richTextToPlain,
  sanitizeRichHtml,
  RICH_TEXT_CLASSES,
} from "@/lib/richText";

// ─── Types ────────────────────────────────────────────────────

interface Broadcast {
  id: string;
  title: string;
  body: string;
  category: "memo" | "training" | "announcement" | "coaching_notes" | "job_posting" | "onboarding";
  magic_word: string | null;
  require_word: boolean;
  status: "published";
  created_at: string;
  confirmed_by_me: boolean;
  word_entered_by_me: string | null;
  link: string | null;
  image_url: string | null;
  sort_order: number;
  tags: string[];
  /** Set on a follow-up: the broadcast it updates. */
  parent_id?: string | null;
  created_by?: string | null;
  /** Who to ask about it. Null on your own broadcast or when the author has left. */
  author_name?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────

// The field stores one URL and nothing else — this is the only way to tell an
// uploaded image apart from an uploaded PDF/Word doc at display time. Mirrors
// VaBroadcastsAdminTab's own copy (kept local rather than shared — a browser/
// portal split this small isn't worth a new lib file for).
function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url);
}

function fileNameFromUrl(url: string): string {
  try {
    return decodeURIComponent(url.split("/").pop() || url);
  } catch {
    return url;
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Injects "Magic word is [word]" into the body as a paragraph after the 60%
 * mark. Position is deterministic per broadcast: uses the char code of the
 * last character of the id to pick which paragraph boundary (split on \n\n)
 * to insert after, within the latter 40% of the text.
 */
function injectMagicWord(body: string, magicWord: string, broadcastId: string): string {
  const injection = `Magic word is ${magicWord}`;
  const anchor = broadcastId.charCodeAt(broadcastId.length - 1); // 0–255

  // Try paragraph-aware insertion first
  const paragraphs = body.split("\n\n");
  if (paragraphs.length >= 2) {
    // Pick an insertion point in the latter 40% of paragraphs
    const minIdx = Math.ceil(paragraphs.length * 0.6);
    const range = paragraphs.length - minIdx; // how many slots available
    const offset = range > 0 ? anchor % range : 0;
    const insertAt = minIdx + offset; // insert AFTER this index
    const result = [
      ...paragraphs.slice(0, insertAt),
      injection,
      ...paragraphs.slice(insertAt),
    ];
    return result.join("\n\n");
  }

  // Fallback: character-level insertion after the 60% mark
  const minPos = Math.floor(body.length * 0.6);
  const range = body.length - minPos;
  const insertPos = minPos + (range > 0 ? anchor % range : 0);
  return body.slice(0, insertPos) + "\n\n" + injection + "\n\n" + body.slice(insertPos);
}

// ─── Category Badge ───────────────────────────────────────────

const CATEGORY_STYLES: Record<
  Broadcast["category"],
  { bg: string; text: string; label: string }
> = {
  memo:            { bg: "bg-sage-soft",        text: "text-sage",       label: "Memo"          },
  training:        { bg: "bg-slate-blue-soft",  text: "text-slate-blue", label: "Training"      },
  announcement:    { bg: "bg-terracotta-soft",  text: "text-terracotta", label: "Announcement"  },
  coaching_notes:  { bg: "bg-amber-100",        text: "text-amber-700",  label: "Coaching Notes"},
  job_posting:     { bg: "bg-terracotta-soft",  text: "text-terracotta", label: "Job Posting"   },
  onboarding:      { bg: "bg-sage-soft",        text: "text-sage",       label: "Onboarding"    },
};

function CategoryBadge({ category }: { category: Broadcast["category"] }) {
  const s = CATEGORY_STYLES[category];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

// ─── Follow-up ────────────────────────────────────────────────

/** A short update on a broadcast, shown at the top of it and acknowledged on its own. */
function FollowUpItem({
  followUp,
  onAcknowledged,
  linked,
}: {
  followUp: Broadcast;
  onAcknowledged: (id: string) => void;
  linked: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAcknowledge = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/broadcasts/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ broadcast_id: followUp.id }),
      });
      if (res.ok) {
        onAcknowledged(followUp.id);
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`rounded-lg border bg-cream p-3 space-y-2 ${linked ? "border-terracotta" : "border-sand"}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">
          Follow-up · {fmtDate(followUp.created_at)}
        </p>
        {followUp.confirmed_by_me && (
          <span className="inline-flex items-center gap-1 rounded-full bg-sage-soft px-2 py-0.5 text-[11px] font-semibold text-sage">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Acknowledged
          </span>
        )}
      </div>
      <div
        className={`text-xs text-bark leading-relaxed ${RICH_TEXT_CLASSES}`}
        dangerouslySetInnerHTML={{ __html: renderBroadcastHtml(followUp.body) }}
      />
      {!followUp.confirmed_by_me && (
        <div className="space-y-2">
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={handleAcknowledge}
            disabled={submitting}
            className="rounded-lg bg-terracotta px-4 py-2 text-[12px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Submitting…" : "Acknowledge update"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Broadcast Card ───────────────────────────────────────────

function BroadcastCard({
  broadcast,
  followUps,
  onAcknowledged,
  linkedId,
}: {
  broadcast: Broadcast;
  /** Updates posted on this broadcast, newest first. */
  followUps: Broadcast[];
  onAcknowledged: (id: string) => void;
  /** The id opened from a shared link — this card's or one of its follow-ups'. */
  linkedId: string | null;
}) {
  const linked = linkedId === broadcast.id || followUps.some((f) => f.id === linkedId);
  const newUpdates = followUps.filter((f) => !f.confirmed_by_me).length;
  const [expanded, setExpanded] = useState(linked);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!linked) return;
    setExpanded(true);
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [linked]);
  const [wordInput, setWordInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Plain-text bodies keep the original text injection; rich bodies inject at an HTML block boundary.
  const anchor = broadcast.id.charCodeAt(broadcast.id.length - 1);
  const displayHtml = !broadcast.magic_word
    ? renderBroadcastHtml(broadcast.body)
    : isRichHtml(broadcast.body)
    ? injectMagicWordHtml(renderBroadcastHtml(broadcast.body), `Magic word is ${broadcast.magic_word}`, (n) => anchor % n)
    : sanitizeRichHtml(plainToHtml(injectMagicWord(broadcast.body, broadcast.magic_word, broadcast.id)));

  const isLong = richTextToPlain(displayHtml).length > 300 || /<img\b/i.test(displayHtml);

  const handleAcknowledge = useCallback(async () => {
    setError(null);

    // Client-side magic word check
    if (broadcast.require_word && broadcast.magic_word) {
      if (wordInput.trim().toLowerCase() !== broadcast.magic_word.toLowerCase()) {
        setError("Incorrect magic word. Please check the message.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload: { broadcast_id: string; word_entered?: string } = {
        broadcast_id: broadcast.id,
      };
      if (broadcast.magic_word) {
        payload.word_entered = wordInput.trim() || undefined;
      }

      const res = await fetch("/api/broadcasts/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onAcknowledged(broadcast.id);
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [broadcast, wordInput, onAcknowledged]);

  const acknowledgeDisabled =
    submitting ||
    (broadcast.require_word && wordInput.trim().length === 0);

  return (
    <div
      ref={cardRef}
      className={`rounded-xl border bg-white p-5 shadow-sm scroll-mt-4 ${linked ? "border-terracotta" : "border-sand"}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <CategoryBadge category={broadcast.category} />
            {broadcast.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-slate-blue-soft px-2 py-0.5 text-[11px] font-semibold capitalize text-slate-blue"
              >
                {tag}
              </span>
            ))}
            {broadcast.confirmed_by_me && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sage-soft px-2 py-0.5 text-[11px] font-semibold text-sage">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Acknowledged
              </span>
            )}
            {newUpdates > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-soft px-2 py-0.5 text-[11px] font-semibold text-amber">
                {newUpdates === 1 ? "New update" : `${newUpdates} new updates`}
              </span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-espresso">{broadcast.title}</h3>
          <p className="text-[11px] text-stone mt-0.5">{fmtDate(broadcast.created_at)}</p>
        </div>
        <BroadcastCopyLinkButton category={broadcast.category} id={broadcast.id} />
      </div>

      {/* Follow-ups — on top, so an update can be read without going through the whole message again */}
      {followUps.length > 0 && (
        <div className="mb-3 space-y-2">
          {followUps.map((f) => (
            <FollowUpItem key={f.id} followUp={f} onAcknowledged={onAcknowledged} linked={f.id === linkedId} />
          ))}
        </div>
      )}

      {/* Image or file attachment */}
      {broadcast.image_url && (
        isImageUrl(broadcast.image_url) ? (
          <div className="mb-3 rounded-lg overflow-hidden">
            <img src={broadcast.image_url} alt={broadcast.title} className="w-full max-h-64 object-cover" />
          </div>
        ) : (
          <a
            href={broadcast.image_url}
            target="_blank"
            rel="noreferrer"
            className="mb-3 inline-flex max-w-full items-center gap-1 rounded-full border border-sand bg-white px-2 py-[2px] text-[11px] font-semibold text-espresso hover:bg-cream"
          >
            <span className="truncate">📎 {fileNameFromUrl(broadcast.image_url)}</span>
          </a>
        )
      )}

      {/* Body */}
      <div
        className={`text-xs text-bark leading-relaxed ${RICH_TEXT_CLASSES} ${
          !expanded && isLong ? "max-h-20 overflow-hidden" : ""
        }`}
        dangerouslySetInnerHTML={{ __html: displayHtml }}
      />
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-terracotta hover:underline cursor-pointer"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}

      {/* Link */}
      {broadcast.link && (
        <div className="mt-3">
          <a
            href={broadcast.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-parchment px-3 py-1.5 text-[12px] font-medium text-terracotta hover:bg-sand transition-colors"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
            View Link
          </a>
        </div>
      )}

      {/* Acknowledge section */}
      {!broadcast.confirmed_by_me && (
        <div className="mt-4 pt-4 border-t border-sand space-y-3">
          {broadcast.magic_word ? (
            <>
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">
                  Enter the magic word here found in the message
                </label>
                <input
                  type="text"
                  value={wordInput}
                  onChange={(e) => { setWordInput(e.target.value); setError(null); }}
                  placeholder="Type the magic word…"
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                onClick={handleAcknowledge}
                disabled={acknowledgeDisabled}
                className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Submitting…" : "Acknowledge"}
              </button>
            </>
          ) : (
            <>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                onClick={handleAcknowledge}
                disabled={submitting}
                className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Submitting…" : "Mark as Read"}
              </button>
            </>
          )}
        </div>
      )}

      {broadcast.created_by && broadcast.author_name && (
        <AskAuthor
          authorId={broadcast.created_by}
          authorName={broadcast.author_name}
          title={broadcast.title}
          category={broadcast.category}
          broadcastId={broadcast.id}
        />
      )}
    </div>
  );
}

// ─── Ask the author ───────────────────────────────────────────

/**
 * A question about a broadcast, sent as a private message to whoever wrote it.
 * It goes through the Dashboard's personal messages, so the author gets the
 * usual bell + Telegram alert and the two of them carry on in that chat.
 */
function AskAuthor({
  authorId,
  authorName,
  title,
  category,
  broadcastId,
}: {
  authorId: string;
  authorName: string;
  title: string;
  category: string;
  broadcastId: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const firstName = authorName.split(" ")[0];

  const handleSend = async () => {
    const question = text.trim();
    if (!question) return;
    setSending(true);
    setError(null);
    try {
      // Find (or start) the Memo questions chat with the author, kept apart
      // from your regular DMs with them, then post the question in it.
      const conv = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_ids: [authorId], kind: "memo" }),
      });
      const c = await conv.json().catch(() => ({}));
      if (!conv.ok || !c.conversation_id) throw new Error(c.error || "Couldn't reach them");

      const path = broadcastPortalPath(category, broadcastId);
      const link = path ? `\n\n${window.location.origin}${path}` : "";
      const res = await fetch(`/api/conversations/${c.conversation_id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: `Question about “${title}”:\n\n${question}${link}` }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't send the question");

      setSent(true);
      setText("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the question");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-4 pt-3 border-t border-sand space-y-2">
      {sent && (
        <p className="text-[11px] text-sage">
          Sent to {firstName}. Their reply will show in your{" "}
          <a href={memoChatPath(authorId)} className="underline hover:text-sage/80">
            Memo questions chat
          </a>
          .
        </p>
      )}
      {open ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setError(null); }}
            rows={3}
            placeholder={`What would you like to ask ${firstName}?`}
            className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-ink bg-white outline-none focus:border-terracotta resize-y"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSend}
              disabled={sending || !text.trim()}
              className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {sending ? "Sending…" : `Send to ${firstName}`}
            </button>
            <button
              onClick={() => { setOpen(false); setError(null); }}
              className="text-xs text-stone hover:text-espresso cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setOpen(true); setSent(false); }}
          className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors cursor-pointer"
        >
          Ask {firstName} a question
        </button>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────

export default function VaBroadcastsPortalTab({ category }: { category?: Broadcast["category"] } = {}) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const linkedId = useSearchParams().get("broadcast");
  // "All" + a tab per tag actually in use here (Toni's call, 2026-11-04) —
  // derived from what's loaded rather than a fixed list, so a brand-new tag
  // shows up as its own tab the moment something is posted with it.
  const [tagFilter, setTagFilter] = useState<string>("all");

  const fetchBroadcasts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/broadcasts");
      const d = await res.json();
      const all: Broadcast[] = d.broadcasts || [];
      // Filter by category if specified
      const filtered = category ? all.filter((b) => b.category === category) : all;
      // Sort by sort_order ascending, then by created_at descending
      filtered.sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setBroadcasts(filtered);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    fetchBroadcasts();
  }, [fetchBroadcasts]);

  // Optimistically mark a broadcast as confirmed in local state
  const handleAcknowledged = useCallback((id: string) => {
    setBroadcasts((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, confirmed_by_me: true } : b
      )
    );
  }, []);

  // Follow-ups show inside the broadcast they update, newest first, never as cards of their own.
  const followUpsByParent = new Map<string, Broadcast[]>();
  broadcasts
    .filter((b) => b.parent_id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .forEach((f) => {
      followUpsByParent.set(f.parent_id!, [...(followUpsByParent.get(f.parent_id!) ?? []), f]);
    });
  const originals = broadcasts.filter((b) => !b.parent_id);

  const availableTags = Array.from(new Set(originals.flatMap((b) => b.tags))).sort((a, b) =>
    a.localeCompare(b)
  );
  const visibleBroadcasts =
    tagFilter === "all" ? originals : originals.filter((b) => b.tags.includes(tagFilter));
  const linkFound =
    !!linkedId &&
    originals.some((b) => b.id === linkedId || (followUpsByParent.get(b.id) ?? []).some((f) => f.id === linkedId));

  return (
    <div className="max-w-4xl space-y-6">
      {!loading && availableTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setTagFilter("all")}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold capitalize transition-colors cursor-pointer ${
              tagFilter === "all" ? "bg-terracotta-soft text-terracotta" : "bg-stone/10 text-stone hover:bg-stone/20"
            }`}
          >
            All
          </button>
          {availableTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setTagFilter(tag)}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold capitalize transition-colors cursor-pointer ${
                tagFilter === tag ? "bg-terracotta-soft text-terracotta" : "bg-stone/10 text-stone hover:bg-stone/20"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-stone">
          <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
          Loading…
        </div>
      )}

      {!loading && linkedId && !linkFound && (
        <div className="rounded-lg border border-sand bg-parchment px-4 py-3 text-xs text-walnut">
          The linked broadcast isn&apos;t available to you — it may have been archived, or sent to someone else.
        </div>
      )}

      {!loading && originals.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 h-12 w-12 rounded-full bg-parchment flex items-center justify-center">
            <svg className="h-5 w-5 text-stone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 00-5-5.917V4a1 1 0 00-2 0v1.083A6 6 0 006 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
          <p className="text-sm font-medium text-espresso">No broadcasts yet</p>
          <p className="mt-1 text-xs text-stone">
            Team announcements, trainings, and memos will appear here.
          </p>
        </div>
      )}

      {!loading && originals.length > 0 && visibleBroadcasts.length === 0 && (
        <p className="text-sm text-stone py-8 text-center">Nothing tagged &quot;{tagFilter}&quot; yet.</p>
      )}

      {!loading && visibleBroadcasts.length > 0 && (
        <div className="space-y-4">
          {visibleBroadcasts.map((b) => (
            <BroadcastCard
              key={b.id}
              broadcast={b}
              followUps={followUpsByParent.get(b.id) ?? []}
              onAcknowledged={handleAcknowledged}
              linkedId={linkedId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
