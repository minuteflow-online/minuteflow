"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The note thread on a bug report, shared by the portal and the admin panel so
 * both sides read and write the same conversation.
 *
 * Whoever filed the report can add to it — that is the point: a report used to be
 * write-once, so anything remembered afterwards had nowhere to go.
 */

interface BugReportNote {
  id: number;
  report_id: number;
  user_id: string;
  full_name: string;
  body: string;
  created_at: string;
}

export default function BugReportNotes({
  reportId,
  currentUserId,
  timezone,
}: {
  reportId: number;
  currentUserId?: string;
  timezone: string;
}) {
  const [notes, setNotes] = useState<BugReportNote[]>([]);
  const [loading, setLoading] = useState(true);
  // Set when the notes table isn't there yet — the section hides itself rather
  // than showing an error on every report.
  const [unavailable, setUnavailable] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/bug-reports/${reportId}/notes`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load notes");
      setNotes(data.notes || []);
      setUnavailable(Boolean(data.unavailable));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notes");
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const addNote = useCallback(async () => {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bug-reports/${reportId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add note");
      setNotes((n) => [...n, data.note]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add note");
    } finally {
      setSaving(false);
    }
  }, [draft, reportId]);

  if (loading || unavailable) return null;

  const formatWhen = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

  return (
    <div className="mt-3 border-t border-parchment pt-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-walnut">
        Notes {notes.length > 0 && <span className="font-normal text-stone">({notes.length})</span>}
      </p>

      {notes.length > 0 && (
        <div className="mb-2 space-y-2">
          {notes.map((note) => (
            <div
              key={note.id}
              className={`rounded-lg border px-2.5 py-2 ${
                note.user_id === currentUserId
                  ? "border-sage/20 bg-sage-soft"
                  : "border-sand bg-cream"
              }`}
            >
              <div className="mb-0.5 flex items-baseline gap-2">
                <span className="text-[11px] font-semibold text-espresso">
                  {note.full_name || "Unknown"}
                </span>
                <span className="text-[10px] text-stone">{formatWhen(note.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-espresso">
                {note.body}
              </p>
            </div>
          ))}
        </div>
      )}

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        placeholder="Add something you forgot, or reply..."
        className="w-full rounded-lg border border-sand bg-white px-2 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={addNote}
          disabled={saving || !draft.trim()}
          className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
        >
          {saving ? "Adding..." : "Add note"}
        </button>
        {error && <span className="text-[10px] text-terracotta">{error}</span>}
      </div>
    </div>
  );
}
