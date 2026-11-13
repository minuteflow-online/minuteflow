// Ported from src/components/SubmitWorkModal.tsx. Same checklist, word-count
// bar, drag/paste/file-picker UX, and Screenshots/Files split (Toni's call,
// 2026-11-10, ported 2026-11-12) — only the upload plumbing differs (see
// src/lib/submissions.ts's comment on why: no @supabase/supabase-js here,
// bearer auth instead of the cookie session).
import { useRef, useState } from "react";
import type { AssignedTaskStatus } from "../lib/tasks";
import {
  countWords,
  submissionMeetsBar,
  MIN_SUBMISSION_WORDS,
  requestUploadSlot,
  uploadFileToSignedSlot,
  postSubmission,
  type PendingAttachment,
} from "../lib/submissions";

/**
 * Run before turning work in. Instructions show the task's own text inline,
 * since a bare label gets ticked without reading. The other two are
 * declarations, which is the point: when work comes back incomplete, they
 * ticked a box saying it wasn't.
 */
const CHECKLIST = [
  { key: "compliant", label: "Complies with instructions" },
  { key: "included", label: "Complete submission" },
  { key: "proofread", label: "Proofread" },
] as const;

interface SubmitWorkModalProps {
  taskId: number;
  taskName: string;
  instructions?: string | null;
  reviewRequired?: boolean | null;
  onClose: () => void;
  /** Receives the status the task should move to: normally "submitted", but
   *  the server auto-completes logged categories and auto-approves tasks
   *  that don't require review. */
  onSubmitted: (status: AssignedTaskStatus) => void;
}

export default function SubmitWorkModal({
  taskId,
  taskName,
  instructions,
  reviewRequired,
  onClose,
  onSubmitted,
}: SubmitWorkModalProps) {
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  // Defaults to Completed — the pre-existing behavior. In Progress is
  // Toni's call, 2026-11-02: a status report that stays on the dashboard
  // rather than a handoff (mirrors web's SubmitWorkModal exactly).
  const [progressStatus, setProgressStatus] = useState<"in_progress" | "completed">("completed");
  const [reviewRequested, setReviewRequested] = useState(false);
  /** Which of the two drop zones a file came from — shown as separate
   *  groups on the Submissions feed instead of one undifferentiated pile
   *  (Toni's call, 2026-11-10). */
  const [files, setFiles] = useState<Array<{ file: File; kind: "screenshot" | "file" }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // Wizard time (Toni's call, 2026-11-13) — mirrors web's SubmitWorkModal:
  // this modal only appears because someone just clicked Submit, so
  // "opened" already means "started filling it out."
  const openedAtRef = useRef(Date.now());

  const words = countWords(message);
  const needsEvidence = reviewRequired !== false;
  const hasContent = needsEvidence
    ? submissionMeetsBar({ message, link, fileCount: files.length })
    : Boolean(message.trim() || link.trim() || files.length > 0);
  const allChecked = !needsEvidence || CHECKLIST.every((c) => checked.has(c.key));
  const canSubmit = hasContent && allChecked;

  const appendFiles = (picked: File[], kind: "screenshot" | "file") => {
    if (picked.length === 0) return;
    setFiles((prev) => [...prev, ...picked.map((file) => ({ file, kind }))]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Pasted files (a screenshot copied to the clipboard, most often — the
  // modal has no way to know which zone the VA "meant", so a paste always
  // lands in Screenshots; a deliberate file goes through the Files zone's
  // own picker or drop target instead). Only intercepted when the clipboard
  // actually carries a file — a plain text paste into the message or link
  // box is left alone.
  const handlePaste = (e: React.ClipboardEvent) => {
    if (saving) return;
    const fromFiles = Array.from(e.clipboardData?.files ?? []);
    const fromItems = Array.from(e.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    const picked = fromFiles.length > 0 ? fromFiles : fromItems;
    if (picked.length === 0) return;
    e.preventDefault();
    appendFiles(picked, "screenshot");
  };

  const screenshotEntries = files
    .map((f, i) => ({ ...f, i }))
    .filter((f) => f.kind === "screenshot");
  const fileEntries = files
    .map((f, i) => ({ ...f, i }))
    .filter((f) => f.kind === "file");

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError("");

    const attachments: PendingAttachment[] = [];

    for (const [index, entry] of files.entries()) {
      const file = entry.file;
      setProgress(`Uploading ${index + 1} of ${files.length}...`);

      const slot = await requestUploadSlot(taskId, file.name, file.size);
      if (!slot) {
        setError(`Couldn't upload ${file.name}. Nothing was recorded.`);
        setProgress("");
        setSaving(false);
        return;
      }

      const uploaded = await uploadFileToSignedSlot(slot.path, slot.token, file);
      if (!uploaded) {
        setError(`Couldn't upload ${file.name}. Nothing was recorded.`);
        setProgress("");
        setSaving(false);
        return;
      }

      attachments.push({
        path: slot.path,
        filename: file.name,
        size: file.size,
        mime_type: file.type || null,
        kind: entry.kind,
      });
    }

    setProgress(files.length > 0 ? "Saving submission..." : "");

    const result = await postSubmission(taskId, {
      message: message.trim(),
      link: link.trim(),
      attachments,
      progressStatus,
      reviewRequested,
      formFillMs: Date.now() - openedAtRef.current,
    });

    if (!result.ok) {
      setError(result.error ?? "Unable to save the submission. Nothing was recorded.");
      setProgress("");
      setSaving(false);
      return;
    }

    onSubmitted((result.autoStatus as AssignedTaskStatus) ?? "submitted");
  };

  const inputClass = "w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white";
  const labelClass = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-walnut";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        onPaste={handlePaste}
        className="relative mx-4 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-sand bg-white shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-sand px-4 py-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-espresso">Submit Work</h3>
            <p className="mt-0.5 text-[11px] text-stone">{taskName}</p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-stone hover:text-espresso disabled:opacity-50 cursor-pointer"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div>
            <label className={labelClass}>This submission is</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setProgressStatus("in_progress")}
                disabled={saving}
                className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  progressStatus === "in_progress"
                    ? "bg-amber text-white"
                    : "border border-sand bg-white text-bark hover:border-amber"
                }`}
              >
                In Progress
              </button>
              <button
                type="button"
                onClick={() => setProgressStatus("completed")}
                disabled={saving}
                className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  progressStatus === "completed"
                    ? "bg-sage text-white"
                    : "border border-sand bg-white text-bark hover:border-sage"
                }`}
              >
                Completed
              </button>
            </div>
            <p className="mt-1 text-[10px] text-stone/70">
              {progressStatus === "in_progress"
                ? "A status update — the task stays on your dashboard, auto-approved unless you ask for a review below."
                : "Done — this goes to review (or completes automatically, depending on the task) and leaves your dashboard."}
            </p>
            {progressStatus === "in_progress" && (
              <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-sand bg-cream/40 p-2">
                <input
                  type="checkbox"
                  checked={reviewRequested}
                  onChange={(e) => setReviewRequested(e.target.checked)}
                  disabled={saving}
                  className="mt-[2px] cursor-pointer accent-terracotta"
                />
                <span className="text-[11px] leading-snug text-espresso">
                  Review required — flag this for Toni instead of auto-approving
                </span>
              </label>
            )}
          </div>

          <div className="space-y-2">
            <AttachZone
              label="Screenshots"
              hint="Process shots — paste (Ctrl/Cmd+V) or drag onto this box"
              entries={screenshotEntries}
              onAdd={(picked) => appendFiles(picked, "screenshot")}
              onRemove={removeFile}
              disabled={saving}
            />
            <AttachZone
              label="Files"
              hint="The finished deliverable — drag onto this box or click to attach"
              entries={fileEntries}
              onAdd={(picked) => appendFiles(picked, "file")}
              onRemove={removeFile}
              disabled={saving}
            />
          </div>

          <div>
            <label className={labelClass}>Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              disabled={saving}
              placeholder="What you completed, notes for review..."
              className={`${inputClass} resize-none`}
            />
          </div>

          <div>
            <label className={labelClass}>Link</label>
            <textarea
              value={link}
              onChange={(e) => setLink(e.target.value)}
              disabled={saving}
              rows={link.includes("\n") ? 3 : 1}
              placeholder="https://... (one per line for more than one)"
              className={`${inputClass} resize-none`}
            />
          </div>

          <div className="rounded-lg border border-sand bg-cream/40 p-2">
            <label className={labelClass}>Before you submit{needsEvidence ? "" : " (optional)"}</label>
            <div className="space-y-1">
              {CHECKLIST.map((item) => (
                <label key={item.key} className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={checked.has(item.key)}
                    onChange={(e) => {
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(item.key);
                        else next.delete(item.key);
                        return next;
                      });
                    }}
                    className="mt-[2px] cursor-pointer accent-terracotta"
                  />
                  <span className="text-[11px] leading-snug text-espresso">
                    {item.label}
                    {item.key === "compliant" && instructions?.trim() && (
                      <span className="mt-0.5 block whitespace-pre-wrap text-[10px] text-stone">{instructions}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {needsEvidence && !hasContent && (
            <p className="rounded-lg border border-sand bg-cream/40 px-2 py-1.5 text-[10px] leading-relaxed text-stone">
              Attach a file or add a link — or, if the message is all there is, describe the work in at least{" "}
              {MIN_SUBMISSION_WORDS} words.
              {words > 0 && ` (${words} so far)`}
            </p>
          )}

          <p className="rounded-lg border border-amber/20 bg-amber-soft px-2 py-1.5 text-[10px] leading-relaxed text-walnut">
            Once submitted this can&apos;t be edited. If something changes, add a note to the task instead — the
            record stays as submitted.
          </p>

          {progress && !error && (
            <p className="rounded-lg border border-sand bg-cream/40 px-2 py-1.5 text-[11px] text-stone">{progress}</p>
          )}

          {error && (
            <p className="rounded-lg border border-terracotta/20 bg-terracotta-soft px-2 py-1.5 text-[11px] text-terracotta">
              {error}
            </p>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 rounded-b-xl border-t border-sand bg-white px-4 py-3">
          {!canSubmit && !saving && (
            <p className="mr-auto text-[10px] leading-snug text-stone">
              {!allChecked
                ? "Tick every box above to enable Submit."
                : needsEvidence
                  ? "Add a file, a link, or a longer message to enable Submit."
                  : "Add a file, a link, or a message to enable Submit."}
            </p>
          )}
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || saving}
            className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50 cursor-pointer"
          >
            {saving ? "Submitting..." : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One of the two attach zones — its own drag target, click-to-browse, and
 * pending-file list. Drag is scoped per zone (rather than the whole modal)
 * since which zone a drop lands in is the point. Ported from web's own.
 */
function AttachZone({
  label,
  hint,
  entries,
  onAdd,
  onRemove,
  disabled,
}: {
  label: string;
  hint: string;
  entries: Array<{ file: File; i: number }>;
  onAdd: (files: File[]) => void;
  onRemove: (i: number) => void;
  disabled: boolean;
}) {
  const [dragActive, setDragActive] = useState(false);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Counted enter/leave rather than a plain boolean — dragging over a child
  // element fires leave-then-enter on the parent, which would otherwise
  // flicker the highlight off mid-drag.
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    setDragActive(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragActive(false);
    }
  };
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    if (disabled) return;
    onAdd(Array.from(e.dataTransfer.files ?? []));
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`rounded-lg border p-2 transition-colors ${
        dragActive ? "border-terracotta bg-terracotta-soft/20" : "border-dashed border-sand"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-walnut">{label}</span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="shrink-0 rounded-lg bg-parchment px-2 py-0.5 text-[10px] font-semibold text-espresso transition-colors hover:bg-sand disabled:opacity-50 cursor-pointer"
        >
          + Add
        </button>
      </div>
      <p className="mt-0.5 text-[10px] text-stone/70">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={(e) => {
          onAdd(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
        className="hidden"
      />
      {entries.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {entries.map(({ file, i }) => (
            <div
              key={`${file.name}-${i}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-sand bg-cream/40 px-2 py-1"
            >
              <span className="truncate text-[11px] text-espresso">{file.name}</span>
              <button
                onClick={() => onRemove(i)}
                disabled={disabled}
                className="shrink-0 text-[11px] font-semibold text-terracotta hover:underline disabled:opacity-50 cursor-pointer"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
