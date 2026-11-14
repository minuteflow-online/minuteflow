"use client";

import { useState } from "react";

import type { SubmissionMessageType, TaskSubmission } from "@/lib/submissions";
import { SUBMISSION_TYPE_BADGE, SUBMISSION_TYPE_LABELS, splitSubmissionLinks } from "@/lib/submissions";
import { linkifyText } from "@/lib/linkify";
import RevisionBadge from "@/components/RevisionBadge";
import SubmissionAttachmentGallery from "@/components/SubmissionAttachmentGallery";

/**
 * Read-only submission thread for the task editor's "Submission Details"
 * section: every submission, resubmission, revision request, approval and note,
 * oldest first — the same sequence the Submissions page shows.
 *
 * These render *beside* the editable task fields, never into them: a
 * submission is append-only, so folding it into `assigned_tasks.task_notes` or
 * `.link` — both freely editable — would quietly destroy the record the whole
 * feature exists to keep.
 */

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

/**
 * The same per-submission link the Submissions page's "Copy link" gives
 * (Toni's call, 2026-11-13): opens that page on the submission, highlighted.
 */
function CopyLinkPill({ taskId, submissionId }: { taskId: number; submissionId: number }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const url = `${window.location.origin}/productivity/submissions?taskId=${taskId}&submission=${submissionId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="ml-auto shrink-0 rounded-full border border-sand bg-parchment/60 px-2 py-[2px] text-[10px] font-semibold text-walnut transition-colors hover:bg-parchment"
      title="Copy a link straight to this submission"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}

export function SubmissionThread({ submissions }: { submissions: TaskSubmission[] }) {
  // The submissions are what the numbering keys off — the first is the
  // original, each one after it a resubmission (R, R2, ...).
  const submissionIndex = new Map(
    submissions.filter((s) => s.message_type === "submission").map((s, i) => [s.id, i])
  );

  return (
    <div className="space-y-1">
      {submissions.map((item) => (
        <SubmissionThreadEntry key={item.id} item={item} index={submissionIndex.get(item.id) ?? 0} />
      ))}
    </div>
  );
}

/**
 * A revision request, collapsed to one line until clicked — the same as on the
 * Submissions page (Toni's call, 2026-11-13).
 */
function RevisionThreadEntry({ item }: { item: TaskSubmission }) {
  const [open, setOpen] = useState(false);
  const note = item.submission_comment?.trim() || item.content;
  return (
    <div className="pt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-1.5 text-left"
        title={open ? "Collapse this revision request" : "Show the full revision request"}
      >
        <span
          className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-semibold ${SUBMISSION_TYPE_BADGE.revision}`}
        >
          {SUBMISSION_TYPE_LABELS.revision}
          <svg className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </span>
        {!open && <span className="min-w-0 truncate text-[11px] text-espresso">{note}</span>}
        <span className="shrink-0 text-[10px] text-stone/80">
          — {byline(item)}
          {item.attachments.length > 0 && !open
            ? ` · ${item.attachments.length} file${item.attachments.length === 1 ? "" : "s"}`
            : ""}
        </span>
      </button>
      {open && (
        <div className="mt-1 pl-1">
          <p className="whitespace-pre-wrap text-[12px] leading-snug text-espresso">{linkifyText(note)}</p>
          {item.attachments.length > 0 && <SubmissionAttachmentGallery attachments={item.attachments} />}
        </div>
      )}
    </div>
  );
}

function SubmissionThreadEntry({ item, index }: { item: TaskSubmission; index: number }) {
  if (item.message_type === "revision") return <RevisionThreadEntry item={item} />;
  // Reviews and notes are events between rounds, not work turned in — they read
  // as a single line, with any file they carry underneath.
  if (item.message_type !== "submission") {
    const type = item.message_type as SubmissionMessageType;
    return (
      <div className="pt-1.5">
        <div className="flex items-start gap-1.5">
          <span
            className={`shrink-0 rounded-full border px-2 py-[2px] text-[10px] font-semibold ${
              SUBMISSION_TYPE_BADGE[type] ?? SUBMISSION_TYPE_BADGE.comment
            }`}
          >
            {SUBMISSION_TYPE_LABELS[type] ?? "Note"}
          </span>
          <span className="min-w-0 whitespace-pre-wrap text-[11px] leading-snug text-espresso">
            {linkifyText(item.submission_comment?.trim() || item.content)}
            <span className="ml-1 text-[10px] text-stone/80">— {byline(item)}</span>
          </span>
        </div>

        {item.attachments.length > 0 && (
          <div className="pl-1">
            <SubmissionAttachmentGallery attachments={item.attachments} />
          </div>
        )}
      </div>
    );
  }

  const isResubmission = index > 0;

  return (
    <div className={isResubmission ? "border-l-2 border-sand pl-3 pt-2" : "pt-1"}>
      <div className="flex items-center gap-1.5">
        <span
          className={`rounded-full border px-2 py-[2px] text-[10px] font-semibold ${
            isResubmission ? "bg-amber-50 text-amber-600 border-amber-200" : SUBMISSION_TYPE_BADGE.submission
          }`}
        >
          {isResubmission ? "Resubmission" : "Submission"}
        </span>
        <RevisionBadge count={index} />
        <span className="text-[10px] text-stone/80">{byline(item)}</span>
        {item.assigned_task_id != null && <CopyLinkPill taskId={item.assigned_task_id} submissionId={item.id} />}
      </div>

      {item.submission_comment && (
        <p className="mt-1.5 max-h-44 overflow-y-auto whitespace-pre-wrap pr-1 text-[12px] leading-snug text-espresso">
          {linkifyText(item.submission_comment)}
        </p>
      )}

      {item.submission_link && (
        <div className="mt-1 space-y-0.5">
          {splitSubmissionLinks(item.submission_link).map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-[12px] text-terracotta hover:underline"
            >
              {url}
            </a>
          ))}
        </div>
      )}

      {item.attachments.length > 0 && <SubmissionAttachmentGallery attachments={item.attachments} />}
    </div>
  );
}
