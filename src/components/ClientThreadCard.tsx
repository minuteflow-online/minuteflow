"use client";

import { useState } from "react";
import {
  SUBMISSION_TYPE_BADGE,
  SUBMISSION_TYPE_LABELS,
  splitSubmissionLinks,
} from "@/lib/submissions";
import { linkifyText } from "@/lib/linkify";
import { answeredSubmission } from "@/lib/submissionThread";
import { deadlineFor, isLate } from "@/lib/onTime";
import { formatStamp, workedSpanLabel, type TaskTime } from "@/lib/submissionTime";
import { buildShotSessions, type ReportLog } from "@/lib/screenshotReport";
import { CaptureGapPills, CaptureStatePills } from "@/components/ScreenshotReportPills";
import SubmissionAttachmentGallery from "@/components/SubmissionAttachmentGallery";
import RevisionBadge from "@/components/RevisionBadge";
import {
  formatDuration,
  scopeLabel,
  type ClientFeedItem,
  type ClientThread,
} from "@/lib/clientSubmissionsTypes";

/** Where a task stands, derived from the newest thread entry. */
const REVIEW_STATE_PILL: Record<string, { label: string; className: string }> = {
  awaiting: { label: "Needs review", className: "bg-amber-50 text-amber-600 border-amber-200" },
  revision_requested: { label: "Revision requested", className: "bg-terracotta-soft text-terracotta border-terracotta/20" },
  approved: { label: "Approved", className: "bg-emerald-50 text-emerald-600 border-emerald-200" },
  completed: { label: "Completed", className: "bg-stone/10 text-stone border-stone/20" },
  in_progress: { label: "In progress", className: "bg-slate-blue-soft text-slate-blue border-slate-blue/20" },
};

export default function ClientThreadCard({
  thread,
  viewDay,
  taskTime,
  scLogs,
  state,
  timezone,
  unreadCount = 0,
  busy,
  onReview,
  onMarkRead,
}: {
  thread: ClientThread;
  viewDay: string;
  taskTime: TaskTime | undefined;
  scLogs: Record<number, ReportLog>;
  state?: string;
  timezone: string;
  unreadCount?: number;
  busy: boolean;
  onReview: (taskId: number, action: "approve" | "revision", note?: string) => void;
  onMarkRead?: (taskId: number) => void;
}) {
  const submissions = thread.items.filter((i) => i.message_type === "submission");
  const head = submissions[0] ?? thread.items[0];
  const latest = submissions[submissions.length - 1] ?? thread.latest;
  const resubmissions = Math.max(0, submissions.length - 1);

  const firstDayOf = (item: ClientFeedItem) => {
    if (item.message_type !== "submission" || !taskTime) return null;
    const round = taskTime.bySubmission[item.id];
    const worked = Object.keys(round?.byDay ?? {}).filter((d) => (round?.byDay[d] ?? 0) > 0);
    if (worked.length > 0) return worked.sort()[0];
    return new Date(item.created_at).toLocaleDateString("en-CA", { timeZone: timezone });
  };
  const anchorDayOf = (item: ClientFeedItem) => {
    const answered = answeredSubmission(thread.items, item);
    return firstDayOf(answered ?? item) ?? new Date(item.created_at).toLocaleDateString("en-CA", { timeZone: timezone });
  };
  const dayItems = thread.items
    .filter((item) => anchorDayOf(item) <= viewDay)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const [expanded, setExpanded] = useState(false);
  const [noteMode, setNoteMode] = useState<null | "revision">(null);
  const [noteDraft, setNoteDraft] = useState("");

  const totalMs = taskTime?.totalMs ?? 0;

  const progressStatusLatest = submissions[submissions.length - 1]?.progress_status ?? null;
  const inProgress = progressStatusLatest === "in_progress";
  const resolvedState = state ?? "awaiting";
  const awaitingReview = resolvedState === "awaiting" && !inProgress;
  const pill = inProgress ? null : REVIEW_STATE_PILL[resolvedState];

  const metaParts = [
    head.task?.category,
    head.profiles?.full_name || head.profiles?.username ? `by ${head.profiles?.full_name || head.profiles?.username}` : null,
    head.task?.assigned_by_name ? `reviewer: ${head.task.assigned_by_name}` : null,
  ].filter(Boolean);

  const cardTitle = head.task?.task_name ?? head.submission_comment?.trim() ?? "Task removed";

  return (
    <div className="rounded-xl border border-sand bg-white p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (!expanded) onMarkRead?.(thread.taskId);
            setExpanded((v) => !v);
          }}
          className="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" className={`shrink-0 text-bark transition-transform ${expanded ? "rotate-90" : ""}`}>
            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="truncate text-[13px] font-semibold leading-tight text-espresso transition-colors group-hover:text-terracotta">
            {cardTitle}
          </span>
          <RevisionBadge count={resubmissions} />
          <span className="shrink-0 rounded-full border border-stone/20 bg-stone/10 px-2 py-[2px] text-[10px] font-semibold text-stone">
            {scopeLabel()}
          </span>
          {inProgress && (
            <span className="shrink-0 text-[10px] font-bold px-1.5 py-[2px] rounded-full bg-slate-blue text-white" title="In progress — a status update from the VA, not a handoff">
              IP
            </span>
          )}
          {awaitingReview && (
            <span className="shrink-0 text-[10px] font-bold px-1.5 py-[2px] rounded-full bg-amber text-white" title="Needs review">
              NR
            </span>
          )}
          {pill && (
            <span className={`shrink-0 rounded-full border px-2 py-[2px] text-[10px] font-semibold ${pill.className}`}>{pill.label}</span>
          )}
        </button>

        {totalMs > 0 && (
          <span className="shrink-0 text-[10px] font-semibold text-stone" title="Total time logged on this task">
            {formatDuration(totalMs)}
          </span>
        )}

        {latest.task && awaitingReview ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => onReview(thread.taskId, "approve")}
              disabled={busy}
              className="rounded-lg bg-sage px-2.5 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
            >
              Approve
            </button>
            {noteMode === "revision" ? (
              <>
                <input
                  autoFocus
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="What needs to change? (optional)"
                  className="w-48 rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none"
                />
                <button
                  onClick={() => {
                    onReview(thread.taskId, "revision", noteDraft);
                    setNoteMode(null);
                    setNoteDraft("");
                  }}
                  disabled={busy}
                  className="rounded-lg bg-amber px-2.5 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-amber/90 disabled:opacity-50"
                >
                  Send
                </button>
                <button
                  onClick={() => setNoteMode(null)}
                  className="text-[10px] font-semibold text-stone hover:text-espresso"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setNoteMode("revision")}
                disabled={busy}
                className="rounded-lg bg-stone/10 px-2.5 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50"
              >
                Request Revision
              </button>
            )}
          </div>
        ) : null}

        {unreadCount > 0 && (
          <span
            className="flex shrink-0 items-center gap-1 rounded-full border border-terracotta/30 bg-terracotta-soft px-1.5 py-[2px] text-[10px] font-semibold text-terracotta"
            title={`${unreadCount} unread`}
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m2 6 10 7 10-7" />
            </svg>
            {unreadCount}
          </span>
        )}
      </div>

      {metaParts.length > 0 && <div className="mt-0.5 pl-[18px] text-[11px] text-stone/80">{metaParts.join(" · ")}</div>}

      {expanded && (
        <div className="mt-2.5 space-y-2.5 border-t border-parchment pt-2.5 pl-[18px]">
          {dayItems.map((item) => {
            const round = submissions.findIndex((s) => s.id === item.id);
            const deadline = deadlineFor(item.task, timezone);
            const late =
              item.message_type === "submission" && deadline ? isLate(item.created_at, item.task, timezone) : null;
            const links = item.submission_link ? splitSubmissionLinks(item.submission_link) : [];
            const sessions = (item.sc_shots?.length ?? 0) > 0 ? buildShotSessions(item.sc_shots ?? [], scLogs) : [];
            const worked = taskTime?.bySubmission[item.id]?.sessions ?? [];
            const span = worked.length > 0 ? workedSpanLabel(worked, timezone) : null;

            return (
              <div key={item.id} id={`submission-${item.id}`} className="text-[12px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`shrink-0 text-[9px] font-semibold px-1.5 py-[1px] rounded-full border ${SUBMISSION_TYPE_BADGE[item.message_type as keyof typeof SUBMISSION_TYPE_BADGE] ?? SUBMISSION_TYPE_BADGE.comment}`}>
                    {SUBMISSION_TYPE_LABELS[item.message_type as keyof typeof SUBMISSION_TYPE_LABELS] ?? item.message_type}
                  </span>
                  {item.message_type === "submission" && round >= 0 && <RevisionBadge count={round} late={late === true} />}
                  <span className="text-[10px] text-bark">
                    {item.profiles?.full_name || item.profiles?.username || "—"} · {formatStamp(new Date(item.created_at).getTime(), timezone, true)}
                    {span && ` · worked ${span}`}
                  </span>
                </div>
                <p className="mt-0.5 text-espresso">{linkifyText(item.content)}</p>
                {links.map((link) => (
                  <a key={link} href={link} target="_blank" rel="noreferrer" className="mt-0.5 block break-all text-[11px] text-terracotta underline hover:no-underline">
                    {link}
                  </a>
                ))}
                {item.attachments.length > 0 && <SubmissionAttachmentGallery attachments={item.attachments} />}
                {sessions.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {sessions.map((s) => (
                      <span key={s.logId ?? "none"} className="flex flex-wrap items-center gap-1">
                        <CaptureStatePills summary={s.summary} orgTimezone={timezone} />
                        <CaptureGapPills summary={s.summary} orgTimezone={timezone} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
