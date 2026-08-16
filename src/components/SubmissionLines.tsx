"use client";

import type { TaskSubmission } from "@/lib/submissions";

/**
 * Read-only submission rows for the task editor.
 *
 * These render *beside* the editable task fields, never into them: a
 * submission is append-only, so folding it into `assigned_tasks.task_notes` or
 * `.link` — both freely editable — would quietly destroy the record the whole
 * feature exists to keep. Each line carries a "Submission" label so it reads
 * as what it is at a glance.
 */

function SubmissionBadge() {
  return (
    <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-[2px] text-[10px] font-semibold text-sky-600">
      Submission
    </span>
  );
}

function byline(submission: TaskSubmission) {
  const who = submission.profiles?.full_name || submission.profiles?.username || "Unknown";
  const when = new Date(submission.created_at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return submission.edited_at ? `${who} · ${when} · edited` : `${who} · ${when}`;
}

/** Submission messages, shown above the editable Notes box. */
export function SubmissionNotes({ submissions }: { submissions: TaskSubmission[] }) {
  const withNotes = submissions.filter((s) => s.submission_comment?.trim());
  if (withNotes.length === 0) return null;

  return (
    <div className="mb-2 space-y-1.5">
      {withNotes.map((s) => (
        <div key={s.id} className="rounded-lg border border-sand bg-cream/40 px-2 py-1.5">
          <div className="flex items-start justify-between gap-2">
            <p className="whitespace-pre-wrap text-[12px] leading-snug text-espresso">
              {s.submission_comment}
            </p>
            <SubmissionBadge />
          </div>
          <p className="mt-1 text-[10px] text-stone/80">{byline(s)}</p>
        </div>
      ))}
    </div>
  );
}

/** Submitted links, shown under the editable task Link field. */
export function SubmissionLinks({ submissions }: { submissions: TaskSubmission[] }) {
  const withLinks = submissions.filter((s) => s.submission_link?.trim());
  if (withLinks.length === 0) return null;

  return (
    <div className="mt-1.5 space-y-1.5">
      {withLinks.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between gap-2 rounded-lg border border-sand bg-cream/40 px-2 py-1.5"
        >
          <a
            href={s.submission_link!}
            target="_blank"
            rel="noreferrer"
            className="truncate text-[12px] text-terracotta hover:underline"
          >
            {s.submission_link}
          </a>
          <SubmissionBadge />
        </div>
      ))}
    </div>
  );
}

/** Submitted files, shown in the Attachments & Screenshots section. */
export function SubmissionFiles({ submissions }: { submissions: TaskSubmission[] }) {
  const files = submissions.flatMap((s) =>
    s.attachments.map((a) => ({ ...a, submission: s }))
  );
  if (files.length === 0) return null;

  return (
    <div className="mt-2">
      <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-amber">
        Submitted Files
      </label>
      <div className="space-y-1.5">
        {files.map((file) => (
          <div
            key={file.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-sand bg-cream/40 px-2 py-1.5"
          >
            <div className="min-w-0">
              {file.url ? (
                <a
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-[12px] text-terracotta hover:underline"
                >
                  {file.filename}
                </a>
              ) : (
                <span className="block truncate text-[12px] text-espresso">{file.filename}</span>
              )}
              <p className="text-[10px] text-stone/80">{byline(file.submission)}</p>
            </div>
            <SubmissionBadge />
          </div>
        ))}
      </div>
    </div>
  );
}
