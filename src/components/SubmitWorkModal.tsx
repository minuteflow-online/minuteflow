"use client";

import { useRef, useState } from "react";
import type { AssignedTaskStatus } from "@/types/database";

interface SubmitWorkModalProps {
  taskId: number;
  taskName: string;
  onClose: () => void;
  /**
   * Called once the submission is saved. Receives the status the task should
   * move to: normally "submitted", but the server auto-completes logged
   * categories and auto-approves tasks that don't require review.
   */
  onSubmitted: (status: AssignedTaskStatus) => void;
}

/**
 * Collects what a VA is turning in before the task moves to "submitted":
 * attachments, a message, a link, or any combination. At least one is
 * required — a bare status flip carries no evidence, which is the whole point
 * of the submission record.
 *
 * Saving is one-way. Once written the VA can't edit it (the RLS update policy
 * for role="va" was dropped); they append a note to the thread instead. The
 * copy below says so before they commit.
 */
export default function SubmitWorkModal({
  taskId,
  taskName,
  onClose,
  onSubmitted,
}: SubmitWorkModalProps) {
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasContent = Boolean(message.trim() || link.trim() || files.length > 0);

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    // Snapshot the FileList NOW, not inside the updater. `input.files` is live:
    // the onChange handler clears `input.value` right after this call (so the
    // same file can be re-picked), which empties that FileList. A deferred
    // Array.from() would copy zero files and the attachment would vanish with
    // no error anywhere.
    const picked = Array.from(list);
    setFiles((prev) => [...prev, ...picked]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!hasContent || saving) return;
    setSaving(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("message_type", "submission");
      if (message.trim()) formData.append("message", message.trim());
      if (link.trim()) formData.append("link", link.trim());
      for (const file of files) formData.append("file", file);

      const res = await fetch(`/api/assigned-tasks/${taskId}/submissions`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Unable to save the submission. Nothing was recorded.");
        setSaving(false);
        return;
      }

      const data = await res.json().catch(() => ({}));
      onSubmitted((data.autoStatus as AssignedTaskStatus) ?? "submitted");
    } catch {
      setError("Network error — nothing was recorded. Try again.");
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white";
  const labelClass = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-walnut";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="mx-4 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-sand bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-sand px-4 py-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-espresso">
              Submit Work
            </h3>
            <p className="mt-0.5 text-[11px] text-stone">{taskName}</p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-stone hover:text-espresso disabled:opacity-50"
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
              className="block w-full text-[11px] text-stone file:mr-2 file:rounded-lg file:border-0 file:bg-parchment file:px-3 file:py-1 file:text-[11px] file:font-semibold file:text-espresso hover:file:bg-sand"
            />
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
                      className="shrink-0 text-[11px] font-semibold text-terracotta hover:underline disabled:opacity-50"
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
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              disabled={saving}
              placeholder="https://..."
              className={inputClass}
            />
          </div>

          <p className="rounded-lg border border-amber/20 bg-amber-soft px-2 py-1.5 text-[10px] leading-relaxed text-walnut">
            Once submitted this can&apos;t be edited. If something changes, add a note to the
            task instead — the record stays as submitted.
          </p>

          {error && (
            <p className="rounded-lg border border-terracotta/20 bg-terracotta-soft px-2 py-1.5 text-[11px] text-terracotta">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-sand px-4 py-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!hasContent || saving}
            className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
          >
            {saving ? "Submitting..." : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
