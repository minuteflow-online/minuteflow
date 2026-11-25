"use client";

import { useEffect, useState } from "react";
import { linkifyText } from "@/lib/linkify";

// The comment thread under a broadcast. Everyone who can read the broadcast sees
// it and can add to it; the author is notified of each new comment.

export interface BroadcastComment {
  id: string;
  body: string;
  created_at: string;
  author_name: string;
  mine: boolean;
  can_delete: boolean;
}

/** Comments for many broadcasts in one request, keyed by broadcast id. */
export async function fetchBroadcastComments(ids: string[]): Promise<Record<string, BroadcastComment[]>> {
  if (ids.length === 0) return {};
  const res = await fetch(`/api/broadcasts/comments?ids=${ids.map(encodeURIComponent).join(",")}`);
  if (!res.ok) return {};
  const d = await res.json().catch(() => ({}));
  return d.comments ?? {};
}

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function BroadcastComments({
  broadcastId,
  initialComments,
  onChange,
}: {
  broadcastId: string;
  /** Loaded by the list (null while it is still loading); when absent the thread loads itself. */
  initialComments?: BroadcastComment[] | null;
  /** Told about every post or delete, so the list can keep the thread. */
  onChange?: (next: BroadcastComment[]) => void;
}) {
  const [comments, setComments] = useState<BroadcastComment[] | null>(initialComments ?? null);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialComments !== undefined) {
      setComments(initialComments);
      return;
    }
    let cancelled = false;
    fetchBroadcastComments([broadcastId]).then((all) => {
      if (!cancelled) setComments(all[broadcastId] ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [broadcastId, initialComments]);

  const handlePost = async () => {
    const body = text.trim();
    if (!body) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/broadcasts/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ broadcast_id: broadcastId, body }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't post your comment");
      const next = [...(comments ?? []), d.comment as BroadcastComment];
      setComments(next);
      onChange?.(next);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't post your comment");
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this comment?")) return;
    setDeleting((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch(`/api/broadcasts/comments?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        const next = (comments ?? []).filter((c) => c.id !== id);
        setComments(next);
        onChange?.(next);
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Couldn't delete that comment");
      }
    } finally {
      setDeleting((p) => ({ ...p, [id]: false }));
    }
  };

  return (
    <div className="mt-4 pt-3 border-t border-sand space-y-3">
      <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">
        Comments{comments && comments.length > 0 ? ` (${comments.length})` : ""}
      </p>

      {comments && comments.length > 0 && (
        <div className="space-y-2">
          {comments.map((c) => (
            <div key={c.id} className="rounded-lg border border-sand bg-cream px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-stone">
                  <span className="font-semibold text-espresso">{c.mine ? "You" : c.author_name}</span>
                  {" · "}
                  {fmtWhen(c.created_at)}
                </p>
                {c.can_delete && (
                  <button
                    onClick={() => handleDelete(c.id)}
                    disabled={!!deleting[c.id]}
                    className="text-[11px] text-stone hover:text-terracotta cursor-pointer disabled:opacity-50"
                  >
                    {deleting[c.id] ? "…" : "Delete"}
                  </button>
                )}
              </div>
              <p className="mt-1 text-[13px] text-espresso whitespace-pre-wrap break-words">{linkifyText(c.body)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          rows={2}
          placeholder="Comment or ask a question…"
          className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-ink bg-white outline-none focus:border-terracotta resize-y"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          onClick={handlePost}
          disabled={posting || !text.trim()}
          className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {posting ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}
