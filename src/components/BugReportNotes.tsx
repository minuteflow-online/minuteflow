"use client";

import { useCallback, useEffect, useState } from "react";
import ScreenshotLightbox from "@/components/ScreenshotLightbox";

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
  drive_file_ids: string[] | null;
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
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A new tab shows the raw image with no way to step through the others; the
  // lightbox keeps the thread in view behind it and arrows between attachments.
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);

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
    // An image on its own is a valid note — "here's what I mean" needs no caption.
    if (!body && files.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // Screenshots go to Google Drive through the same route the report form
      // uses. Uploaded before the note is created so a failed upload doesn't
      // leave a note claiming attachments it never got.
      const driveFileIds: string[] = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const up = await fetch("/api/bug-reports/upload", { method: "POST", body: fd });
        if (!up.ok) throw new Error("Could not upload attachment");
        const uploaded = await up.json();
        if (uploaded.drive_file_id) driveFileIds.push(uploaded.drive_file_id);
      }

      const res = await fetch(`/api/bug-reports/${reportId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, drive_file_ids: driveFileIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add note");
      setNotes((n) => [...n, data.note]);
      setDraft("");
      setFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add note");
    } finally {
      setSaving(false);
    }
  }, [draft, files, reportId]);

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
              {note.body && (
                <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-espresso">
                  {note.body}
                </p>
              )}
              {(note.drive_file_ids?.length ?? 0) > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {note.drive_file_ids!.map((fileId, i) => (
                    <button
                      key={fileId}
                      type="button"
                      onClick={() =>
                        setLightbox({
                          urls: (note.drive_file_ids ?? []).map(
                            (id) => `/api/drive-image?id=${id}`
                          ),
                          index: i,
                        })
                      }
                      className="block overflow-hidden rounded border border-sand transition-all hover:border-terracotta"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/drive-image?id=${fileId}`}
                        alt="Attachment"
                        loading="lazy"
                        className="h-[72px] w-[96px] object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
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
      {files.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {files.map((file, i) => (
            <span
              key={`${file.name}-${i}`}
              className="flex items-center gap-1.5 rounded-lg border border-sand bg-cream px-2 py-1 text-[10px] text-espresso"
            >
              {file.name.length > 24 ? `${file.name.slice(0, 24)}…` : file.name}
              <button
                onClick={() => setFiles((f) => f.filter((_, idx) => idx !== i))}
                className="text-stone transition-colors hover:text-terracotta"
                aria-label={`Remove ${file.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <button
          onClick={addNote}
          disabled={saving || (!draft.trim() && files.length === 0)}
          className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
        >
          {saving ? "Adding..." : "Add note"}
        </button>

        <label className="cursor-pointer rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20">
          Attach screenshot
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              setFiles((f) => [...f, ...Array.from(e.target.files || [])]);
              // Cleared so re-picking the same file still fires a change event.
              e.target.value = "";
            }}
          />
        </label>

        {error && <span className="text-[10px] text-terracotta">{error}</span>}
      </div>

      {lightbox && (
        <ScreenshotLightbox
          urls={lightbox.urls}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
