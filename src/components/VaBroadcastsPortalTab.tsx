"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import BroadcastCopyLinkButton from "@/components/BroadcastCopyLinkButton";
import { compareBroadcastOrder } from "@/lib/broadcasts";
import BroadcastFilters, {
  applyBroadcastFilters,
  EMPTY_BROADCAST_FILTERS,
  type BroadcastFilterState,
} from "@/components/BroadcastFilters";
import BroadcastComments, { fetchBroadcastComments, type BroadcastComment } from "@/components/BroadcastComments";
import { broadcastDisplayHtml, handleDetailsButtonClick } from "@/lib/broadcastDisplay";
import { magicWordsMatch, parseMagicWords } from "@/lib/magicWords";
import { renderBroadcastHtml, richTextToPlain, RICH_TEXT_CLASSES } from "@/lib/richText";

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
  /** Who published it (even if they've left) — for the Author filter. */
  published_by_name?: string | null;
  /** Always listed first. */
  pinned?: boolean;
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
  comments,
  onCommentsChange,
}: {
  broadcast: Broadcast;
  /** Updates posted on this broadcast, newest first. */
  followUps: Broadcast[];
  onAcknowledged: (id: string) => void;
  /** The id opened from a shared link — this card's or one of its follow-ups'. */
  linkedId: string | null;
  /** Its comment thread, null while the list is still loading them. */
  comments: BroadcastComment[] | null;
  onCommentsChange: (id: string, next: BroadcastComment[]) => void;
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
  const magicWords = parseMagicWords(broadcast.magic_word);
  // One box per magic word; a VA must fill in every one (any order).
  const [wordInputs, setWordInputs] = useState<string[]>(() => magicWords.map(() => ""));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same placement as the admin list (see broadcastDisplayHtml).
  const displayHtml = broadcastDisplayHtml(broadcast);

  const isLong = richTextToPlain(displayHtml).length > 300 || /<img\b/i.test(displayHtml);

  const handleAcknowledge = useCallback(async () => {
    setError(null);

    // Commas would split one box into several words, so each box is taken as one word.
    const entered = wordInputs.map((w) => w.replace(/,/g, " ").trim()).filter(Boolean).join(", ");

    // Client-side magic word check
    if (broadcast.require_word && broadcast.magic_word && !magicWordsMatch(broadcast.magic_word, entered)) {
      setError(
        magicWords.length > 1
          ? "One or more magic words are incorrect. Please check the message."
          : "Incorrect magic word. Please check the message."
      );
      return;
    }

    setSubmitting(true);
    try {
      const payload: { broadcast_id: string; word_entered?: string } = {
        broadcast_id: broadcast.id,
      };
      if (broadcast.magic_word) {
        payload.word_entered = entered || undefined;
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
  }, [broadcast, magicWords.length, wordInputs, onAcknowledged]);

  const acknowledgeDisabled =
    submitting ||
    (broadcast.require_word && wordInputs.some((w) => w.trim().length === 0));

  return (
    <div
      ref={cardRef}
      className={`rounded-xl border bg-white p-5 shadow-sm scroll-mt-4 ${linked ? "border-terracotta" : "border-sand"}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {broadcast.pinned && <PinnedBadge />}
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
        onClick={(e) => {
          // "Expand all" also opens the card if it's cut off
          if (handleDetailsButtonClick(e) === "open") setExpanded(true);
        }}
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
                  {magicWords.length > 1
                    ? `Enter all ${magicWords.length} magic words found in the message (any order)`
                    : "Enter the magic word here found in the message"}
                </label>
                <div className="space-y-2">
                  {wordInputs.map((w, i) => (
                    <input
                      key={i}
                      type="text"
                      value={w}
                      onChange={(e) => {
                        const next = [...wordInputs];
                        next[i] = e.target.value;
                        setWordInputs(next);
                        setError(null);
                      }}
                      placeholder={magicWords.length > 1 ? `Magic word ${i + 1}…` : "Type the magic word…"}
                      className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                    />
                  ))}
                </div>
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

      <BroadcastComments
        broadcastId={broadcast.id}
        initialComments={comments}
        onChange={(next) => onCommentsChange(broadcast.id, next)}
      />
    </div>
  );
}

function PinnedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-2 py-0.5 text-[11px] font-semibold text-amber">
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 17v5" />
        <path d="M9 10.76V6h6v4.76l2 2.24v2H7v-2z" />
        <path d="M8 6h8" />
      </svg>
      Pinned
    </span>
  );
}

const NO_COMMENTS: BroadcastComment[] = [];

// ─── Main Component ───────────────────────────────────────────

export default function VaBroadcastsPortalTab({
  category,
}: { category?: Broadcast["category"] | Broadcast["category"][] } = {}) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const linkedId = useSearchParams().get("broadcast");
  // Type / Account / Author, each multi-select (Toni's call, 2026-11-20). The options
  // come from what's loaded, so a brand-new tag or author shows up on its own.
  const [filters, setFilters] = useState<BroadcastFilterState>(EMPTY_BROADCAST_FILTERS);
  // Every card's comment thread, loaded in one go after the list
  const [comments, setComments] = useState<Record<string, BroadcastComment[]> | null>(null);
  const categoryKey = Array.isArray(category) ? category.join(",") : category ?? "";

  const fetchBroadcasts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/broadcasts");
      const d = await res.json();
      const all: Broadcast[] = d.broadcasts || [];
      // Filter by category if specified
      const wanted = categoryKey ? categoryKey.split(",") : null;
      const filtered = wanted ? all.filter((b) => wanted.includes(b.category)) : all;
      // Pinned first, then sort_order ascending, then newest first
      filtered.sort(compareBroadcastOrder);
      setBroadcasts(filtered);
      fetchBroadcastComments(filtered.filter((b) => !b.parent_id).map((b) => b.id)).then(setComments);
    } finally {
      setLoading(false);
    }
  }, [categoryKey]);

  useEffect(() => {
    fetchBroadcasts();
  }, [fetchBroadcasts]);

  // Keep each thread here so it survives a card leaving and re-entering the filtered list
  const handleCommentsChange = useCallback((id: string, next: BroadcastComment[]) => {
    setComments((prev) => ({ ...(prev ?? {}), [id]: next }));
  }, []);

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

  const visibleBroadcasts = applyBroadcastFilters(originals, filters);
  const linkFound =
    !!linkedId &&
    originals.some((b) => b.id === linkedId || (followUpsByParent.get(b.id) ?? []).some((f) => f.id === linkedId));

  return (
    <div className="max-w-4xl space-y-6">
      {!loading && <BroadcastFilters items={originals} value={filters} onChange={setFilters} />}

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
        <p className="text-sm text-stone py-8 text-center">Nothing matches these filters.</p>
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
              comments={comments ? comments[b.id] ?? NO_COMMENTS : null}
              onCommentsChange={handleCommentsChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
