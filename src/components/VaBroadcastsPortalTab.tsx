"use client";

import { useEffect, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────

interface Broadcast {
  id: string;
  title: string;
  body: string;
  category: "memo" | "training" | "announcement";
  magic_word: string | null;
  require_word: boolean;
  status: "published";
  created_at: string;
  confirmed_by_me: boolean;
  word_entered_by_me: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────

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
  memo:         { bg: "bg-sage-soft",        text: "text-sage",       label: "Memo"         },
  training:     { bg: "bg-slate-blue-soft",  text: "text-slate-blue", label: "Training"     },
  announcement: { bg: "bg-terracotta-soft",  text: "text-terracotta", label: "Announcement" },
};

function CategoryBadge({ category }: { category: Broadcast["category"] }) {
  const s = CATEGORY_STYLES[category];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

// ─── Broadcast Card ───────────────────────────────────────────

function BroadcastCard({
  broadcast,
  onAcknowledged,
}: {
  broadcast: Broadcast;
  onAcknowledged: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [wordInput, setWordInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayBody = broadcast.magic_word
    ? injectMagicWord(broadcast.body, broadcast.magic_word, broadcast.id)
    : broadcast.body;

  const isLong = displayBody.length > 300;

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
    <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <CategoryBadge category={broadcast.category} />
            {broadcast.confirmed_by_me && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sage-soft px-2 py-0.5 text-[11px] font-semibold text-sage">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Acknowledged
              </span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-espresso">{broadcast.title}</h3>
          <p className="text-[11px] text-stone mt-0.5">{fmtDate(broadcast.created_at)}</p>
        </div>
      </div>

      {/* Body */}
      <div
        className={`text-xs text-bark leading-relaxed whitespace-pre-wrap ${
          !expanded && isLong ? "line-clamp-4" : ""
        }`}
      >
        {displayBody}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-terracotta hover:underline cursor-pointer"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
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
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────

export default function VaBroadcastsPortalTab() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBroadcasts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/broadcasts");
      const d = await res.json();
      setBroadcasts(d.broadcasts || []);
    } finally {
      setLoading(false);
    }
  }, []);

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

  return (
    <div className="max-w-4xl space-y-6">
      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-stone">
          <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
          Loading…
        </div>
      )}

      {!loading && broadcasts.length === 0 && (
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

      {!loading && broadcasts.length > 0 && (
        <div className="space-y-4">
          {broadcasts.map((b) => (
            <BroadcastCard
              key={b.id}
              broadcast={b}
              onAcknowledged={handleAcknowledged}
            />
          ))}
        </div>
      )}
    </div>
  );
}
