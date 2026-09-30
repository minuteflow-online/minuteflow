// Ported from src/components/SubmitWorkModal.tsx. Same checklist, word-count
// bar, and drag/paste/file-picker UX — only the upload plumbing differs (see
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
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const words = countWords(message);
  const needsEvidence = reviewRequired !== false;
  const hasContent = needsEvidence
    ? submissionMeetsBar({ message, link, fileCount: files.length })
    : Boolean(message.trim() || link.trim() || files.length > 0);
  const allChecked = !needsEvidence || CHECKLIST.every((c) => checked.has(c.key));
  const canSubmit = hasContent && allChecked;
  const [dragActive, setDragActive] = useState(false);
  const dragCounter = useRef(0);

  const appendFiles = (picked: File[]) => {
    if (picked.length === 0) return;
    setFiles((prev) => [...prev, ...picked]);
  };

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    appendFiles(Array.from(list));
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

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
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    if (saving) return;
    appendFiles(Array.from(e.dataTransfer.files ?? []));
  };

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
    appendFiles(picked);
  };

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError("");

    const attachments: PendingAttachment[] = [];

    for (const [index, file] of files.entries()) {
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
      });
    }

    setProgress(files.length > 0 ? "Saving submission..." : "");

    const result = await postSubmission(taskId, {
      message: message.trim(),
      link: link.trim(),
      attachments,
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
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onPaste={handlePaste}
        className={`relative mx-4 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border bg-white shadow-xl transition-colors ${
          dragActive ? "border-terracotta" : "border-sand"
        }`}
      >
        {dragActive && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-terracotta bg-terracotta-soft/40">
            <p className="text-[12px] font-semibold text-terracotta">Drop to attach</p>
          </div>
        )}
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
            <label className={labelClass}>Attachment</label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
              className="block w-full text-[11px] text-stone file:mr-2 file:rounded-lg file:border-0 file:bg-parchment file:px-3 file:py-1 file:text-[11px] file:font-semibold file:text-espresso hover:file:bg-sand file:cursor-pointer"
            />
            <p className="mt-1 text-[10px] text-stone/70">or drag files onto this window, or paste (Ctrl/Cmd+V)</p>
            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((file, i) => (
                  <div
                    key={`${file.name}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-sand bg-cream/40 px-2 py-1"
                  >
                    <span className="truncate text-[11px] text-espresso">{file.name}</span>
                    <button
                      onClick={() => removeFile(i)}
                      disabled={saving}
                      className="shrink-0 text-[11px] font-semibold text-terracotta hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
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
