"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TaskSubmissionAttachment } from "@/lib/submissions";

/** A file already uploaded to `task-attachments` via the signed-slot route,
 *  waiting to be hung off the submission row it's posted with. Same shape
 *  the submissions page's note/revision box sends. */
type PendingAttachment = {
  path: string;
  filename: string;
  size: number;
  mime_type: string | null;
};

/** The submission being reviewed — a structural subset of the submissions
 *  page's FeedItem, so that type can be passed straight in without a cast. */
export type ReviewableSubmission = {
  id: number;
  user_id: string;
  submission_link: string | null;
  submission_comment: string | null;
  attachments: TaskSubmissionAttachment[];
  profiles?: { id: string; full_name: string | null; username: string | null } | null;
  task: {
    id: number;
    task_name: string;
    task_detail?: string | null;
    account?: string | null;
  } | null;
};

type Todo = { id: number; text: string; sort_order: number };

/** The two outcomes this modal can post — a subset of the page's ReviewOutcome. */
type Outcome = "approval" | "revision";

/**
 * Consolidates submission review into two gates, run in order:
 *
 * 1. Completeness — does the work cover everything the task asked for? A
 *    reviewer checks off each to-do item that's actually present — "Check
 *    all" when everything obviously is. Anything left unchecked becomes the
 *    reason on an immediate revision, and Quality is never reached.
 * 2. Quality — Approve or Revise, same outcome and API call the submissions
 *    page already made from its inline buttons.
 *
 * Deliberately not in scope here: open Q&A visibility (no Q&A feature exists
 * yet — see the build plan) and a VA-side self-check at submission time (this
 * gate is the reviewer's own confirmation, not a second layer on top of one
 * the VA already did — that's a fuller version to build later if it's wanted).
 */
export default function ReviewModal({
  submission,
  busy,
  onReview,
  onClose,
}: {
  submission: ReviewableSubmission;
  busy: boolean;
  onReview: (
    outcome: Outcome,
    note?: string,
    dueAt?: string,
    attachments?: PendingAttachment[]
  ) => void;
  onClose: () => void;
}) {
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [todosError, setTodosError] = useState("");

  const [step, setStep] = useState<"completeness" | "quality">("completeness");
  // Checked = confirmed present. Anything left unchecked is what's missing —
  // the opposite of a "flag problems" checklist, so a reviewer's default
  // state (nothing checked yet) reads as "nothing confirmed yet," not as
  // "everything's wrong."
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [incompleteNote, setIncompleteNote] = useState("");

  const [qualityMode, setQualityMode] = useState<null | "revision">(null);
  const [qualityNote, setQualityNote] = useState("");
  const [revisionDue, setRevisionDue] = useState("");

  const taskId = submission.task?.id ?? null;

  // Attach-by-upload/paste on a revision request — same signed-slot flow the
  // submissions page's own note box uses, so a reviewer can point at what's
  // wrong (a screenshot, say) instead of just describing it.
  const [revisionFiles, setRevisionFiles] = useState<File[]>([]);
  const [revisionUploading, setRevisionUploading] = useState(false);
  const [revisionUploadError, setRevisionUploadError] = useState("");
  const [revisionProgress, setRevisionProgress] = useState("");
  const revisionSupabase = useMemo(() => createClient(), []);

  const addRevisionFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setRevisionFiles((prev) => [...prev, ...Array.from(list)]);
  };
  const removeRevisionFile = (index: number) => {
    setRevisionFiles((prev) => prev.filter((_, i) => i !== index));
  };
  // Only intercepted when the clipboard actually carries a file (a screenshot
  // copied in) — a plain text paste into the textarea is left alone.
  const handleRevisionPaste = (e: React.ClipboardEvent) => {
    if (busy || revisionUploading) return;
    const fromFiles = Array.from(e.clipboardData?.files ?? []);
    const fromItems = Array.from(e.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    const picked = fromFiles.length > 0 ? fromFiles : fromItems;
    if (picked.length === 0) return;
    e.preventDefault();
    setRevisionFiles((prev) => [...prev, ...picked]);
  };

  /** Uploads any attached files, then posts the revision request. */
  const submitRevision = async () => {
    const note = qualityNote.trim();
    if (!note) return;
    setRevisionUploadError("");
    setRevisionUploading(true);
    try {
      const attachments: PendingAttachment[] = [];
      for (const [index, file] of revisionFiles.entries()) {
        setRevisionProgress(`Uploading ${index + 1} of ${revisionFiles.length}...`);
        const slotRes = await fetch(`/api/assigned-tasks/${taskId}/submissions/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, size: file.size }),
        });
        if (!slotRes.ok) {
          const body = await slotRes.json().catch(() => ({}));
          setRevisionUploadError(body.error ?? `Couldn't upload ${file.name}.`);
          return;
        }
        const { path, token } = await slotRes.json();
        const { error: uploadError } = await revisionSupabase.storage
          .from("task-attachments")
          .uploadToSignedUrl(path, token, file);
        if (uploadError) {
          setRevisionUploadError(`Couldn't upload ${file.name}: ${uploadError.message}`);
          return;
        }
        attachments.push({
          path,
          filename: file.name,
          size: file.size,
          mime_type: file.type || null,
        });
      }
      setRevisionProgress("");
      onReview(
        "revision",
        note,
        revisionDue ? new Date(revisionDue).toISOString() : undefined,
        attachments.length > 0 ? attachments : undefined
      );
    } finally {
      setRevisionProgress("");
      setRevisionUploading(false);
    }
  };

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/assigned-tasks/${taskId}`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setTodosError("Couldn't load the to-do list.");
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        const list: Todo[] = (data.task?.task_todos ?? [])
          .slice()
          .sort((a: Todo, b: Todo) => a.sort_order - b.sort_order);
        setTodos(list);
        // Nothing's confirmed yet, so the reason box starts pre-filled with
        // every item rather than sitting empty until the first click.
        if (list.length > 0) {
          setIncompleteNote(`Missing: ${list.map((t) => t.text).join("; ")}`);
        }
      } catch {
        if (!cancelled) setTodosError("Couldn't load the to-do list.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // The reason box pre-fills from whatever's still unconfirmed, so a
  // reviewer rarely has to type from scratch — but it stays editable, since a
  // to-do's stored text isn't always the clearest way to say what's missing.
  function fillReasonFrom(next: Set<number>) {
    const items = (todos ?? []).filter((t) => !next.has(t.id)).map((t) => t.text);
    setIncompleteNote(items.length > 0 ? `Missing: ${items.join("; ")}` : "");
  }

  function toggleConfirmed(id: number) {
    setConfirmed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      fillReasonFrom(next);
      return next;
    });
  }

  function confirmAll() {
    const next = new Set((todos ?? []).map((t) => t.id));
    setConfirmed(next);
    fillReasonFrom(next);
  }

  const who = submission.profiles?.full_name || submission.profiles?.username || "This VA";

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-4 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-sand bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-sand px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-xs font-bold uppercase tracking-wide text-espresso">Review</h3>
            <p className="truncate text-[13px] font-semibold leading-snug text-espresso">
              {submission.task?.task_name ?? "Task removed"}
            </p>
            <p className="mt-0.5 text-[11px] text-stone">Submitted by {who}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-stone hover:text-espresso"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-4">
          {/* The work itself, so the reviewer never has to leave the modal to
              see what's being judged. */}
          <div className="rounded-lg border border-sand bg-cream/40 p-2.5">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-walnut">
              Submission
            </p>
            {submission.submission_comment && (
              <p className="whitespace-pre-wrap text-[12px] leading-snug text-espresso">
                {submission.submission_comment}
              </p>
            )}
            {submission.submission_link && (
              <a
                href={submission.submission_link}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block truncate text-[12px] text-terracotta hover:underline"
              >
                {submission.submission_link}
              </a>
            )}
            {submission.attachments.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {submission.attachments.map((file) => (
                  <a
                    key={file.id}
                    href={file.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-sand bg-white px-2 py-1 text-[11px] text-terracotta hover:bg-cream"
                  >
                    {file.filename}
                  </a>
                ))}
              </div>
            )}
            {!submission.submission_comment &&
              !submission.submission_link &&
              submission.attachments.length === 0 && (
                <p className="text-[12px] italic text-stone/60">Nothing written or attached.</p>
              )}
          </div>

          {/* Gate 1 — Completeness. Stays open until an overall call is made,
              since a reviewer may want the checklist visible while deciding. */}
          <div className="rounded-lg border border-sand p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-walnut">
                Gate 1 · Completeness
              </p>
              {step === "quality" && (
                <span className="rounded-full border border-sage/20 bg-sage-soft px-2 py-[2px] text-[10px] font-semibold text-sage">
                  Complete
                </span>
              )}
            </div>

            {todosError && <p className="text-[12px] text-terracotta">{todosError}</p>}
            {!todosError && todos === null && (
              <p className="text-[12px] italic text-stone/60">Loading checklist…</p>
            )}
            {!todosError && todos !== null && todos.length === 0 && (
              <p className="text-[12px] italic text-stone/60">
                No to-dos on this task — nothing to check off.
              </p>
            )}
            {!todosError && todos !== null && todos.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-stone">
                    Check off what&apos;s actually there.
                  </p>
                  {step === "completeness" && confirmed.size < todos.length && (
                    <button
                      onClick={confirmAll}
                      disabled={busy}
                      className="text-[10px] font-semibold text-stone transition-colors hover:text-espresso disabled:opacity-50"
                    >
                      Check all
                    </button>
                  )}
                </div>
                {todos.map((todo) => (
                  <label
                    key={todo.id}
                    className="flex cursor-pointer items-start gap-2 rounded-lg border border-sand bg-cream/40 px-2 py-1 text-[12px] text-espresso"
                  >
                    <input
                      type="checkbox"
                      checked={confirmed.has(todo.id)}
                      onChange={() => toggleConfirmed(todo.id)}
                      disabled={step === "quality"}
                      className="mt-0.5 cursor-pointer accent-sage disabled:cursor-default"
                    />
                    <span className={confirmed.has(todo.id) ? "text-sage" : undefined}>
                      {todo.text}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {step === "completeness" && (
              <div className="mt-2">
                {(todos?.length ?? 0) > confirmed.size && (
                  <textarea
                    value={incompleteNote}
                    onChange={(e) => setIncompleteNote(e.target.value)}
                    rows={2}
                    className="mb-1.5 w-full resize-none rounded-lg border border-sand bg-white px-2 py-1.5 text-xs text-espresso outline-none"
                  />
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setStep("quality")}
                    disabled={busy}
                    className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
                  >
                    Complete
                  </button>
                  <button
                    onClick={() => {
                      if (!incompleteNote.trim()) return;
                      onReview("revision", `Incomplete — ${incompleteNote.trim()}`);
                    }}
                    disabled={
                      busy || (todos?.length ?? 0) <= confirmed.size || !incompleteNote.trim()
                    }
                    className="rounded-lg bg-terracotta px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:opacity-50"
                    title={
                      (todos?.length ?? 0) <= confirmed.size
                        ? "Nothing left unconfirmed — everything's checked"
                        : undefined
                    }
                  >
                    Incomplete — send back
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Gate 2 — Quality. Only reachable once Completeness has passed. */}
          {step === "quality" && (
            <div className="rounded-lg border border-sand p-2.5">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-walnut">
                Gate 2 · Quality
              </p>

              {qualityMode === "revision" ? (
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-walnut">
                    What needs changing?
                  </label>
                  <textarea
                    value={qualityNote}
                    onChange={(e) => setQualityNote(e.target.value)}
                    onPaste={handleRevisionPaste}
                    rows={2}
                    autoFocus
                    placeholder="Tell them what to fix..."
                    className="w-full resize-none rounded-lg border border-sand bg-white px-2 py-1.5 text-xs text-espresso outline-none"
                  />
                  <div className="mt-1.5">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-walnut">
                      New due date (optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={revisionDue}
                      onChange={(e) => setRevisionDue(e.target.value)}
                      className="rounded-lg border border-sand bg-white px-2 py-1 text-[11px] text-espresso outline-none"
                    />
                  </div>

                  <div className="mt-1.5">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-walnut">
                      Attachment
                    </label>
                    <input
                      type="file"
                      multiple
                      onChange={(e) => {
                        addRevisionFiles(e.target.files);
                        e.target.value = "";
                      }}
                      disabled={revisionUploading}
                      className="block w-full text-[10px] text-stone file:mr-2 file:rounded-lg file:border-0 file:bg-parchment file:px-2 file:py-1 file:text-[10px] file:font-semibold file:text-espresso hover:file:bg-sand disabled:opacity-50"
                    />
                    <p className="mt-0.5 text-[10px] text-stone/70">
                      or paste a screenshot (Ctrl/Cmd+V) into the note above
                    </p>
                    {revisionFiles.length > 0 && (
                      <div className="mt-1 space-y-1">
                        {revisionFiles.map((file, i) => (
                          <div
                            key={`${file.name}-${i}`}
                            className="flex items-center justify-between gap-2 rounded-lg border border-sand bg-white px-2 py-1"
                          >
                            <span className="truncate text-[11px] text-espresso">{file.name}</span>
                            <button
                              onClick={() => removeRevisionFile(i)}
                              disabled={revisionUploading}
                              className="shrink-0 text-[10px] font-semibold text-terracotta hover:underline disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {revisionProgress && !revisionUploadError && (
                    <p className="mt-1.5 text-[10px] text-stone">{revisionProgress}</p>
                  )}
                  {revisionUploadError && (
                    <p className="mt-1.5 text-[10px] text-terracotta">{revisionUploadError}</p>
                  )}

                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      onClick={submitRevision}
                      disabled={busy || revisionUploading || !qualityNote.trim()}
                      className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
                    >
                      {revisionUploading ? "Saving..." : "Request Revision"}
                    </button>
                    <button
                      onClick={() => setQualityMode(null)}
                      disabled={busy || revisionUploading}
                      className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onReview("approval")}
                    disabled={busy}
                    className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => setQualityMode("revision")}
                    disabled={busy}
                    className="rounded-lg bg-stone/10 px-3 py-1 text-[11px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50"
                  >
                    Revise
                  </button>
                  <button
                    onClick={() => setStep("completeness")}
                    disabled={busy}
                    className="ml-auto text-[10px] font-semibold text-stone transition-colors hover:text-espresso"
                  >
                    ← Back
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
