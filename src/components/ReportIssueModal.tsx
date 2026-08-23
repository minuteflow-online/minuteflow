"use client";

import { useCallback, useState } from "react";

// One form, two report types. Both live in the same `bug_reports` table with a
// `report_type` discriminator — a feature request is just a report that isn't a
// bug, and both want the same title/description/screenshot fields and the same
// Telegram ping.
export type ReportType = "bug" | "feature";

export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  bug: "Bug",
  feature: "Feature Request",
};

// Statuses are shared across both types (submitted → testing → fixed) so
// filtering and the admin control stay single-path. Only the wording differs.
export const REPORT_STATUS_LABEL: Record<ReportType, Record<string, string>> = {
  // "Dismissed" reads better than "Won't fix" to whoever filed it — it says the
  // request was considered and closed, not that it was wrong to raise.
  bug: { submitted: "Submitted", testing: "Reviewing", fixed: "Fixed", dismissed: "Dismissed" },
  feature: { submitted: "Submitted", testing: "Reviewing", fixed: "Shipped", dismissed: "Dismissed" },
};

export function BugIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M12 22c4.418 0 8-3.582 8-8s-3.582-8-8-8-8 3.582-8 8 3.582 8 8 8z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

export function IdeaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.3.3.5.7.5 1.1v1h6v-1c0-.4.2-.8.5-1.1A6 6 0 0 0 12 3z" />
    </svg>
  );
}

const PLACEHOLDERS: Record<ReportType, { title: string; description: string }> = {
  bug: {
    title: "Brief description of the issue",
    description: "Steps to reproduce, what happened, what you expected...",
  },
  feature: {
    title: "What would you like MinuteFlow to do?",
    description: "What problem would this solve? How would you use it?",
  },
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
  defaultType?: ReportType;
};

// The form only exists while the modal is open, so every open mounts it fresh —
// a half-typed report from last time is noise, not a draft worth keeping.
export default function ReportIssueModal({ open, ...rest }: Props) {
  if (!open) return null;
  return <ReportForm {...rest} />;
}

function ReportForm({ onClose, onSubmitted, defaultType = "bug" }: Omit<Props, "open">) {
  const [reportType, setReportType] = useState<ReportType>(defaultType);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reportDate, setReportDate] = useState(new Date().toISOString().split("T")[0]);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || !description.trim()) return;
    setSubmitting(true);
    setError(null);

    // Screenshots go to Google Drive via the upload route — never Supabase.
    const driveFileIds: string[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/bug-reports/upload", { method: "POST", body: fd });
      if (up.ok) {
        const d = await up.json();
        if (d.drive_file_id) driveFileIds.push(d.drive_file_id);
      }
    }

    const res = await fetch("/api/bug-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        report_type: reportType,
        title: title.trim(),
        description: description.trim(),
        report_date: reportDate,
        drive_file_ids: driveFileIds,
      }),
    });
    setSubmitting(false);

    if (res.ok) {
      setDone(true);
      onSubmitted?.();
      setTimeout(() => onClose(), 1400);
    } else {
      const e = await res.json().catch(() => ({}));
      setError(e.error || "Failed to submit");
    }
  }, [reportType, title, description, reportDate, files, onSubmitted, onClose]);

  const ph = PLACEHOLDERS[reportType];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-lg rounded-xl border border-sand bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
          <h3 className="text-sm font-bold text-espresso">Report a Bug or Request a Feature</h3>
          <button
            onClick={onClose}
            className="cursor-pointer text-lg leading-none text-bark hover:text-terracotta"
          >
            &times;
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Type toggle — the one control that lets a single button serve both */}
          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-walnut">
              What are you sending? <span className="text-terracotta">*</span>
            </p>
            <div className="flex gap-2">
              {([
                { value: "bug" as const, label: "Bug", hint: "Something is broken", Icon: BugIcon },
                { value: "feature" as const, label: "Feature Request", hint: "An idea to make this better", Icon: IdeaIcon },
              ]).map(({ value, label, hint, Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setReportType(value)}
                  className={`flex flex-1 cursor-pointer flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-all ${
                    reportType === value
                      ? value === "bug"
                        ? "border-terracotta bg-terracotta text-white"
                        : "border-sage bg-sage text-white"
                      : "border-sand bg-white text-bark hover:border-terracotta"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </span>
                  <span className={`text-[10px] ${reportType === value ? "text-white/80" : "text-stone"}`}>
                    {hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold tracking-wide text-walnut">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={ph.title}
              autoFocus
              className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold tracking-wide text-walnut">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder={ph.description}
              className="w-full resize-none rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
            />
          </div>

          {/* A date only means something for a bug — it's when it happened. */}
          {reportType === "bug" && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold tracking-wide text-walnut">
                When did it happen?
              </label>
              <input
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className="rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-semibold tracking-wide text-walnut">
              Screenshots <span className="font-normal text-stone">(optional)</span>
            </label>
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
              className="text-xs text-stone"
            />
            {files.length > 0 && (
              <p className="mt-1 text-[11px] text-stone">
                {files.length} file{files.length !== 1 ? "s" : ""} selected
              </p>
            )}
          </div>

          {error && <p className="text-xs font-medium text-terracotta">{error}</p>}
          {done && (
            <p className="text-xs font-medium text-sage">
              {reportType === "bug" ? "Bug report sent. Thank you!" : "Feature request sent. Thank you!"}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 cursor-pointer rounded-lg border border-sand bg-parchment py-2.5 text-[13px] font-semibold text-walnut transition-all hover:bg-sand hover:text-espresso"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || done || !title.trim() || !description.trim()}
              className="flex-1 cursor-pointer rounded-lg bg-sage py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-sage/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Sending..." : done ? "Sent" : `Send ${REPORT_TYPE_LABEL[reportType]}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
