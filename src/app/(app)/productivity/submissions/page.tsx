"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setAssignedTaskStatus } from "@/lib/assignedTaskStatus";
import {
  SUBMISSION_TYPE_BADGE,
  SUBMISSION_TYPE_LABELS,
  splitSubmissionLinks,
  type SubmissionMessageType,
  type SubmissionScopeFilter,
  type TaskSubmissionAttachment,
} from "@/lib/submissions";
import { linkifyText } from "@/lib/linkify";
import RevisionBadge from "@/components/RevisionBadge";
import ScreenshotLightbox from "@/components/ScreenshotLightbox";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import TaskDetailModal from "@/components/TaskDetailModal";
import ReviewModal from "@/components/ReviewModal";
import { useColumnPrefs, type ColumnDef } from "@/components/table/useColumnPrefs";
import type { AssignedTaskStatus, Project } from "@/types/database";
import { CATEGORY_OPTIONS } from "@/lib/taskSchedule";
import { isUnreadCandidate } from "@/lib/submissionUnread";

type FeedItem = {
  id: number;
  assigned_task_id: number | null;
  user_id: string;
  message_type: string;
  content: string;
  submission_link: string | null;
  submission_comment: string | null;
  created_at: string;
  edited_at: string | null;
  /** Set on a revision entry: the new deadline for the rework. */
  due_at: string | null;
  attachments: TaskSubmissionAttachment[];
  profiles?: { id: string; full_name: string | null; username: string | null } | null;
  task: {
    id: number;
    task_name: string;
    task_detail: string | null;
    account: string | null;
    project: string | null;
    project_id: string | null;
    project_kind: string | null;
    project_name: string | null;
    status: string | null;
    category: string | null;
    review_required: boolean | null;
    assigned_by: string | null;
    assigned_by_name: string | null;
    is_output_based: boolean;
    due_date: string | null;
    due_time: string | null;
    end_date: string | null;
    end_time: string | null;
  } | null;
};

/** Every submission for one task, oldest first — the original plus its resubmissions. */
type Thread = { taskId: number; items: FeedItem[]; latest: FeedItem };

/** A file already uploaded to `task-attachments` via the signed-slot route,
 *  waiting to be hung off the submission row it's posted with. Mirrors what
 *  SubmitWorkModal sends. */
type PendingAttachment = {
  path: string;
  filename: string;
  size: number;
  mime_type: string | null;
};

type TeamMember = { id: string; full_name: string; username: string };

/** The client behind an account — only its name is shown on a card. */
type ClientRow = { id: string; name: string };

type ViewMode = "timeline" | "calendar";

/**
 * Whose submissions to show. Everyone has both sides: work they turned in,
 * and work turned in on tasks they assigned — assigned_by is the reviewer.
 */
type OwnerMode = "all" | "mine" | "to_me";

const OWNER_MODES: Array<{ value: OwnerMode; label: string }> = [
  { value: "all", label: "All" },
  { value: "mine", label: "My submissions" },
  { value: "to_me", label: "Submitted to me" },
];

/** The three review outcomes a reviewer can append to a thread. */
type ReviewOutcome = "approval" | "revision" | "approval_reversed";

const REVIEW_DEFAULT_NOTE: Record<ReviewOutcome, string> = {
  approval: "Approved",
  revision: "Revision requested",
  approval_reversed: "Approval reversed",
};

/**
 * Where the task lands after each outcome. Reversing an approval puts it back
 * in front of the reviewer rather than back on the VA — nothing about the work
 * changed, only the decision did.
 */
const REVIEW_STATUS: Record<ReviewOutcome, AssignedTaskStatus> = {
  approval: "approved",
  revision: "revision_needed",
  approval_reversed: "submitted",
};

/**
 * Status filter options. These match the pills on the cards, so what you
 * filter by is what you see labelled.
 */
const STATUS_OPTIONS = [
  { value: "awaiting", label: "Review" },
  { value: "revision_requested", label: "Revision" },
  { value: "approved", label: "Approved" },
  { value: "auto_approved", label: "Auto approved" },
  { value: "completed", label: "Completed" },
];

const WORK_TYPE_OPTIONS = [
  { value: "time_based", label: "Time-based" },
  { value: "output_based", label: "Output-based" },
];

/**
 * What a card shows, chosen per person. A reviewer watching one client wants
 * different lines than someone scanning their own work, and the card has room
 * for only a few.
 *
 * Reuses the table column-prefs machinery so a choice follows the person
 * across devices rather than living in one browser. Widths go unused here —
 * a card is not a grid — but the hook's type asks for them.
 */
const CARD_FIELDS: ColumnDef[] = [
  { key: "account", label: "Account", defaultWidth: 0 },
  { key: "client", label: "Client", defaultWidth: 0 },
  { key: "client_detail", label: "Client detail", defaultWidth: 0 },
  { key: "message", label: "Submission message", defaultWidth: 0 },
  { key: "project", label: "Objective / Operation", defaultWidth: 0 },
  { key: "reviewer", label: "Reviewer", defaultWidth: 0 },
  { key: "category", label: "Category", defaultWidth: 0 },
  { key: "submitter", label: "Submitted by", defaultWidth: 0 },
  { key: "count", label: "Submission count", defaultWidth: 0 },
  { key: "total_time", label: "Total time", defaultWidth: 0 },
];

/**
 * Anything a card can show, it can lead with. Built from CARD_FIELDS rather
 * than a second hand-written list, so a field added there is immediately
 * available as a title instead of quietly missing from one of the two.
 */
const TITLE_FIELDS = [
  { value: "task", label: "Task" },
  ...CARD_FIELDS.map((f) => ({ value: f.key, label: f.label })),
];
type TitleField = string;

/** Enough to scan in one screenful without scrolling for a minute. */
const THREADS_PER_PAGE = 25;

const SCOPE_OPTIONS: Array<{ value: SubmissionScopeFilter; label: string }> = [
  { value: "all", label: "All work" },
  { value: "objective", label: "Objective" },
  { value: "operation", label: "Operations" },
  { value: "adhoc", label: "Adhoc" },
];

/**
 * Where a task stands, derived server-side from the last thread entry.
 * "awaiting" is the only state with anything for a reviewer to do.
 */
const REVIEW_STATE_PILL: Record<string, { label: string; className: string }> = {
  awaiting: { label: "Needs review", className: "bg-amber-50 text-amber-600 border-amber-200" },
  revision_requested: {
    label: "Revision requested",
    className: "bg-terracotta-soft text-terracotta border-terracotta/20",
  },
  approved: { label: "Approved", className: "bg-emerald-50 text-emerald-600 border-emerald-200" },
  // Distinct from a human Approved: this task was flagged review_required =
  // false, so nobody looked at it. Worth being able to tell apart at a glance.
  auto_approved: { label: "Auto approved", className: "bg-sage-soft text-sage border-sage/20" },
  completed: { label: "Completed", className: "bg-stone/10 text-stone border-stone/20" },
};

/** "1h 23m" / "45m" / "30s" — compact enough to sit inline on a badge row. */
function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "0m";
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Local YYYY-MM-DD for a timestamp, in the org's timezone. */
function localDay(iso: string, timezone: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: timezone });
}

/**
 * Applies a filter that describes submitted work — "from this VA", "in this
 * date range" — by deciding which THREADS qualify (does the task have a
 * `submission` entry matching `predicate`), then keeps every row on a
 * qualifying thread regardless of that row's own fields.
 *
 * The naive version — `rows.filter(predicate)` applied to every row — looks
 * right and passes every obvious test, because most rows in a thread share
 * the task's own fields (VA, account, category...) and only a submission's
 * `user_id` or `created_at` usually varies. But a note or a review is a row
 * too, and it's authored by whoever added it and timestamped when they did —
 * neither of which has anything to do with who submitted the work or when.
 * Filtering it against the same predicate as the submission silently strips
 * it off an otherwise-visible thread. That's exactly what happened on
 * 2026-09-14: Toni's own note vanished the instant she wrote it, because a
 * "Flordeliz Mandin" VA filter was active and the note was written by Toni,
 * not Flordeliz — the thread stayed visible, only her note disappeared from
 * it, which read as "my note didn't save" when it had saved fine.
 *
 * `expected` rows (due but nothing submitted yet) have no submission to key
 * off, so they fall back to `predicate` directly — the same check the
 * naive version would have made for them.
 */
function keepQualifyingThreads(
  rows: FeedItem[],
  predicate: (row: FeedItem) => boolean
): FeedItem[] {
  const qualifyingTaskIds = new Set(
    rows
      .filter((r) => r.message_type === "submission" && predicate(r))
      .map((r) => r.task?.id ?? r.assigned_task_id)
      .filter((id): id is number => id != null)
  );
  return rows.filter((r) => {
    if (r.message_type === "expected") return predicate(r);
    const taskId = r.task?.id ?? r.assigned_task_id;
    return taskId != null && qualifyingTaskIds.has(taskId);
  });
}

/**
 * A From/To date-range chip, same button/popover chrome as MultiSelectFilter
 * so it reads as one filter bar rather than two different widgets bolted
 * together. Either end can be left blank — an open-ended range still narrows.
 */
function DateRangeChip({
  label,
  from,
  to,
  onChange,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const active = Boolean(from || to);
  const buttonLabel = !active
    ? label
    : from && to
      ? `${from} – ${to}`
      : from
        ? `From ${from}`
        : `To ${to}`;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] outline-none transition-colors ${
          active
            ? "border-terracotta/40 bg-terracotta-soft text-terracotta font-semibold"
            : "border-sand bg-white text-espresso"
        }`}
      >
        <span className="max-w-[160px] truncate">{active ? buttonLabel : label}</span>
        <svg width="8" height="8" viewBox="0 0 12 12" className="shrink-0 opacity-60">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-30 w-56 space-y-2 rounded-lg border border-sand bg-white p-2 shadow-lg">
          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-walnut">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => onChange(e.target.value, to)}
              className="w-full rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
            />
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-walnut">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => onChange(from, e.target.value)}
              className="w-full rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
            />
          </div>
          {active && (
            <button
              type="button"
              onClick={() => onChange("", "")}
              className="w-full rounded-lg text-[10px] font-semibold text-terracotta hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The moment the work was due, as a local "YYYY-MM-DD HH:MM:SS" string.
 *
 * Prefers due_date/due_time; without a due time the whole due day counts as on
 * time. Falls back to the scheduled block's end when no due date was set, and
 * returns null when the task carries no schedule at all — an unscheduled task
 * can't be late, so it gets no verdict rather than a wrong one.
 */
function deadlineFor(task: FeedItem["task"], timezone: string): string | null {
  if (!task) return null;
  if (task.due_date) {
    return `${task.due_date} ${(task.due_time ?? "23:59:59").padEnd(8, ":00").slice(0, 8)}`;
  }
  if (task.end_time) {
    return `${localDay(task.end_time, timezone)} ${new Date(task.end_time).toLocaleTimeString("en-GB", { hour12: false, timeZone: timezone })}`;
  }
  if (task.end_date) return `${task.end_date} 23:59:00`;
  return null;
}

/**
 * Comparing local wall-clock strings rather than instants keeps a due_time like
 * "17:27" — which carries no timezone — anchored to the org's day, so the
 * verdict doesn't shift with the viewer's location.
 */
/**
 * The deadline in force when a submission landed.
 *
 * A revision can set a new due date for the rework. Judging every submission
 * against whatever the task says today would let a moved deadline rewrite an
 * earlier verdict — work that was on time becoming late months later. Each
 * submission is measured against the most recent revision deadline before
 * it, and the task's own due date only when no revision has moved it.
 */
function deadlineForSubmission(
  item: FeedItem,
  thread: FeedItem[],
  timezone: string
): string | null {
  const priorRevision = thread
    .filter((e) => e.message_type === "revision" && e.due_at && e.created_at < item.created_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  if (priorRevision?.due_at) {
    const when = new Date(priorRevision.due_at);
    return `${localDay(priorRevision.due_at, timezone)} ${when.toLocaleTimeString("en-GB", { hour12: false, timeZone: timezone })}`;
  }
  return deadlineFor(item.task, timezone);
}

function isLate(item: FeedItem, timezone: string, thread?: FeedItem[]): boolean | null {
  const deadline = thread
    ? deadlineForSubmission(item, thread, timezone)
    : deadlineFor(item.task, timezone);
  if (!deadline) return null;
  const submitted = `${localDay(item.created_at, timezone)} ${new Date(item.created_at).toLocaleTimeString("en-GB", { hour12: false, timeZone: timezone })}`;
  return submitted > deadline;
}

/**
 * How a submission landed against its deadline.
 *
 * "same day" is separated from "another day" because they are different
 * failures: an hour past the time is a slip, a day past it is a miss, and
 * one colour for both hides which happened.
 */
type Timeliness = "on_time" | "late_same_day" | "late_other_day" | "no_deadline";

function timelinessOf(item: FeedItem, timezone: string): Timeliness {
  const deadline = deadlineFor(item.task, timezone);
  if (!deadline) return "no_deadline";
  const submitted = `${localDay(item.created_at, timezone)} ${new Date(item.created_at).toLocaleTimeString("en-GB", { hour12: false, timeZone: timezone })}`;
  if (submitted <= deadline) return "on_time";
  return localDay(item.created_at, timezone) === deadline.slice(0, 10)
    ? "late_same_day"
    : "late_other_day";
}

/**
 * Light blue is reserved for work that is due and not yet in — see
 * EXPECTED_CHIP. A submission with no due date can't be judged on time, so it
 * reads neutral rather than borrowing that blue.
 */
const TIMELINESS_CHIP: Record<Timeliness, string> = {
  on_time: "border-emerald-200 bg-emerald-50 text-emerald-700",
  late_same_day: "border-amber-200 bg-amber-50 text-amber-700",
  late_other_day: "border-plum/30 bg-plum-soft text-plum",
  no_deadline: "border-sand bg-parchment/60 text-walnut",
};

/**
 * A due date waiting on its work. It sits blue until something is turned in,
 * and the submission that replaces it carries the verdict colour: green on
 * time, amber late the same day, plum a day or more late. Terracotta is the
 * fourth outcome — the day passed and nothing arrived.
 */
const EXPECTED_CHIP = "border-sky-200 bg-sky-100/70 text-sky-600";

/**
 * Short forms for the calendar, where a chip has room for a task name and
 * little else. Anything not listed falls back to its initials, so a new
 * account still gets a sensible tag without an edit here.
 */
const ACCOUNT_ABBR: Record<string, string> = {
  "Education Encompassed": "EE",
  "TAT Foundation": "TAT",
  "Quad Life": "QL",
  "Thess Personal": "Tess",
  "Thess Base": "TessB",
  "Virtual Concierge": "VC",
  "WSB Awesome Team": "WSB",
  "Colina Portrait": "CP",
  "SNAPS Sublimation": "SNAPS",
  "Right Path Agency": "RPA",
  TONIWSB: "TWSB",
  Personal: "PERS",
};

function accountAbbr(account: string | null | undefined): string | null {
  const name = account?.trim();
  if (!name) return null;
  if (ACCOUNT_ABBR[name]) return ACCOUNT_ABBR[name];
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 4);
}

/** First and last initial — Charinade Liezel David reads CD, not CLD. */
function personInitials(person?: { full_name?: string | null; username?: string | null } | null) {
  const name = person?.full_name?.trim() || person?.username?.trim();
  if (!name) return null;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}
const MISSED_CHIP = "border-terracotta/30 bg-terracotta-soft text-terracotta";

const TIMELINESS_LABEL: Record<Timeliness, string> = {
  on_time: "On time",
  late_same_day: "Late — same day",
  late_other_day: "Late — another day",
  no_deadline: "No due date set",
};

function scopeLabel(item: FeedItem) {
  if (!item.task?.project_id) return "Adhoc";
  if (item.task.project_kind === "objective") return "Objective";
  if (item.task.project_kind === "operation") return "Operations";
  return "Project";
}

// useSearchParams() (for the ?taskId= deep link from a notification) opts the
// page out of static rendering unless it's wrapped in Suspense — the real
// component moves below and this just supplies that boundary.
export default function SubmissionsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl px-4 pb-12 text-[12px] text-stone">Loading submissions...</div>}>
      <SubmissionsPageInner />
    </Suspense>
  );
}

function SubmissionsPageInner() {
  const supabase = useMemo(() => createClient(), []);

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  // taskId -> round -> ms logged. JSON object keys are strings.
  const [roundDurations, setRoundDurations] = useState<Record<string, Record<string, number>>>({});
  const [reviewState, setReviewState] = useState<Record<string, string>>({});
  const [canReview, setCanReview] = useState(false);
  const [canEmptyTrash, setCanEmptyTrash] = useState(false);
  const [seesAll, setSeesAll] = useState(false);
  const [orgTimezone, setOrgTimezone] = useState("UTC");

  const [view, setView] = useState<ViewMode>("timeline");
  const [ownerMode, setOwnerMode] = useState<OwnerMode>("all");
  const [currentUserId, setCurrentUserId] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const { hidden: hiddenFields, toggleColumnVisible } = useColumnPrefs(
    "submissions-card",
    currentUserId || null,
    CARD_FIELDS
  );
  const [titleField, setTitleField] = useState<TitleField>("task");

  // Title choice is one string, so it stays in localStorage rather than
  // riding along in the column-prefs payload, which only models widths and
  // hidden keys.
  useEffect(() => {
    if (!currentUserId) return;
    try {
      const saved = localStorage.getItem(`mf-submissions-title:${currentUserId}`);
      if (saved) setTitleField(saved as TitleField);
    } catch {
      // Unavailable storage — the default is fine.
    }
  }, [currentUserId]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [batchApproving, setBatchApproving] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [assignedByFilter, setAssignedByFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  // Every filter is multi-select; an empty set means "all".
  const [vaFilter, setVaFilter] = useState<Set<string>>(new Set());
  const [scopeFilter, setScopeFilter] = useState<Set<string>>(new Set());
  const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());
  const [workTypeFilter, setWorkTypeFilter] = useState<Set<string>>(new Set());
  // Was defaulted to Task-only, meaning to hide Communication/Planning/
  // Collaboration noise (those auto-complete on submit). But an empty/null
  // category -- e.g. an output-based task's mirrored row, which had a real bug
  // dropping its category entirely -- doesn't match "Task" either, so it
  // silently vanished the same way the noise was meant to. Defaults to "show
  // everything" now that the real bug is fixed at the source; the noisy
  // categories are one click away in this same filter if they get in the way.
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [accountFilter, setAccountFilter] = useState<Set<string>>(new Set());
  const [clientFilter, setClientFilter] = useState<Set<string>>(new Set());
  // Two separate date ranges — a task's due date and when it was actually
  // submitted are different questions ("what was owed this week" vs "what
  // came in this week"), so one combined filter would conflate them.
  const [taskDateFrom, setTaskDateFrom] = useState("");
  const [taskDateTo, setTaskDateTo] = useState("");
  const [submissionDateFrom, setSubmissionDateFrom] = useState("");
  const [submissionDateTo, setSubmissionDateTo] = useState("");

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  // client id -> the account names billed to that client, since a task points
  // at an account by name and only the mapping table knows the client.
  const [accountsByClient, setAccountsByClient] = useState<Map<string, Set<string>>>(new Map());
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [busyId, setBusyId] = useState<number | null>(null);

  // assigned_task_id -> how many unread comments/notes this viewer has on
  // that task's thread. Drives the ✉️ badge and the Unread filter below.
  const [unreadByTask, setUnreadByTask] = useState<Record<number, number>>({});
  const [unreadOnly, setUnreadOnly] = useState(false);

  // A notification click arrives as ?taskId=123 — jump straight to that
  // thread instead of leaving the reader to find it among everyone else's
  // filters. Read once: it's a one-time "you arrived here for a reason", not
  // something that should keep overriding filters the person picks after.
  const searchParams = useSearchParams();
  const [highlightTaskId, setHighlightTaskId] = useState<number | null>(null);
  useEffect(() => {
    const raw = searchParams.get("taskId");
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed)) return;
    setHighlightTaskId(parsed);
    // Clear every filter that could hide the target thread — a notification
    // has to land you on the thing it's about, not on an empty "no matches".
    setOwnerMode("all");
    setShowTrash(false);
    setUnreadOnly(false);
    setStatusFilter(new Set());
    setVaFilter(new Set());
    setScopeFilter(new Set());
    setProjectFilter(new Set());
    setWorkTypeFilter(new Set());
    setCategoryFilter(new Set());
    setAccountFilter(new Set());
    setClientFilter(new Set());
    setAssignedByFilter(new Set());
    setTaskDateFrom("");
    setTaskDateTo("");
    setSubmissionDateFrom("");
    setSubmissionDateTo("");
    setSearch("");
  }, [searchParams]);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);

      const { data: org } = await supabase
        .from("organization_settings")
        .select("timezone")
        .limit(1)
        .single();
      if (org?.timezone) setOrgTimezone(org.timezone);
    })();
  }, [supabase]);

  useEffect(() => {
    fetch("/api/team-members")
      .then((r) => r.json())
      .then((d) => setTeamMembers(d.members ?? []))
      .catch(() => {});
    fetch("/api/projects?mine=true", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => {});
    fetch("/api/accounts", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts ?? []))
      .catch(() => {});
    fetch("/api/clients", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setClients((d.clients ?? []) as ClientRow[]);
        const map = new Map<string, Set<string>>();
        for (const m of (d.mappings ?? []) as Array<{
          client_id: string;
          accounts?: { name?: string } | null;
        }>) {
          const name = m.accounts?.name;
          if (!name) continue;
          const set = map.get(m.client_id) ?? new Set<string>();
          set.add(name);
          map.set(m.client_id, set);
        }
        setAccountsByClient(map);
      })
      .catch(() => {});
  }, []);

  // Everything is fetched once and narrowed in the browser — with multi-select
  // filters, re-querying on every checkbox would be a request per click.
  // The API still enforces that a non-admin only ever receives their own rows.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/submissions${showTrash ? "?trash=1" : ""}`, { cache: "no-store" });
      const data = await res.json();
      // Expected work rides in the same list so every filter — VA, account,
      // project, assigner — applies to it without a second copy of the
      // filtering. Only the calendar reads it; the timeline skips it.
      setItems([...(data.submissions ?? []), ...(data.expected ?? [])]);
      setRoundDurations(data.roundDurations ?? {});
      setReviewState(data.reviewState ?? {});
      setCanReview(Boolean(data.canReview));
      setCanEmptyTrash(Boolean(data.canEmptyTrash));
      setSeesAll(Boolean(data.seesAll));
      setUnreadByTask(data.unreadByTask ?? {});
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [showTrash]);

  // Any change to what's being shown starts at the first page — page 4 of a
  // freshly filtered list is not where anyone wants to land.
  useEffect(() => {
    setPage(0);
  }, [vaFilter, scopeFilter, projectFilter, categoryFilter, accountFilter, clientFilter, statusFilter, assignedByFilter, ownerMode, showTrash, search]);

  useEffect(() => {
    void load();
  }, [load]);

  // Approve / Request revision append a row to the same thread, then move the
  // task's status through the app's single status path.
  const review = useCallback(
    async (
      item: FeedItem,
      outcome: ReviewOutcome,
      note?: string,
      dueAt?: string,
      attachments?: PendingAttachment[]
    ) => {
      if (!item.task) return;
      setBusyId(item.id);
      try {
        const res = await fetch(`/api/assigned-tasks/${item.task.id}/submissions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message_type: outcome,
            message: note?.trim() || REVIEW_DEFAULT_NOTE[outcome],
            due_at: dueAt || null,
            attachments,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          alert(data.error ?? "Unable to record the review.");
          return;
        }
        // The thread entry is already written and can't be taken back, so a
        // failed status write must be surfaced rather than swallowed — otherwise
        // the task silently stays put while the timeline claims it was reviewed.
        const moved = await setAssignedTaskStatus({
          assignedTaskId: item.task.id,
          status: REVIEW_STATUS[outcome],
          vaId: item.user_id,
        });
        if (!moved) {
          alert(
            `Your ${REVIEW_DEFAULT_NOTE[outcome].toLowerCase()} was recorded on the submission, but the task's status could not be updated. The task has not moved — please change it from the task list.`
          );
        }
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  const handleSelectChange = useCallback((taskId: number, checked: boolean) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }, []);

  /** Trashes or restores every submission on the selected tasks. */
  const trashSelected = useCallback(
    async (restore: boolean) => {
      const targets = items.filter(
        (i) => i.task && selectedTaskIds.has(i.task.id)
      );
      const taskCount = selectedTaskIds.size;
      if (
        !restore &&
        !confirm(
          `Move ${targets.length} submission${targets.length === 1 ? "" : "s"} across ${taskCount} task${taskCount === 1 ? "" : "s"} to trash?

They can be restored from the Trash view.`
        )
      ) {
        return;
      }
      try {
        for (const item of targets) {
          if (!item.task) continue;
          await fetch(
            `/api/assigned-tasks/${item.task.id}/submissions?submissionId=${item.id}${restore ? "&restore=1" : ""}`,
            { method: "DELETE" }
          );
        }
        setSelectedTaskIds(new Set());
        await load();
      } catch {
        alert("Something went wrong — some submissions may not have moved.");
      }
    },
    [items, selectedTaskIds, load]
  );

  /**
   * Cancels a reversal made by mistake: the entry is trashed, and the task
   * goes back to approved. Nothing is destroyed — the row keeps deleted_at,
   * so the reversal is still there for anyone auditing the database.
   */
  const cancelReversal = useCallback(
    async (item: FeedItem) => {
      if (!item.task) return;
      setBusyId(item.id);
      try {
        const res = await fetch(
          `/api/assigned-tasks/${item.task.id}/submissions?submissionId=${item.id}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          alert(data.error ?? "Unable to cancel the reversal.");
          return;
        }
        await setAssignedTaskStatus({
          assignedTaskId: item.task.id,
          status: "approved",
          vaId: item.user_id,
        });
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  /** Permanently removes everything in the trash. Founder only, and final. */
  const emptyTrash = useCallback(async () => {
    const count = items.length;
    if (
      !confirm(
        `Permanently delete ${count} trashed submission${count === 1 ? "" : "s"} and their files?

This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch("/api/submissions", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Unable to empty the trash.");
        return;
      }
      await load();
    } catch {
      alert("Network error — nothing was deleted.");
    }
  }, [items.length, load]);

  /**
   * Moves a submission to trash, or restores it. Soft only — the row and its
   * files survive, because a submission is the evidence behind a status change.
   */
  const trashSubmission = useCallback(
    async (item: FeedItem, restore: boolean) => {
      if (!item.task) return;
      setBusyId(item.id);
      try {
        const res = await fetch(
          `/api/assigned-tasks/${item.task.id}/submissions?submissionId=${item.id}${restore ? "&restore=1" : ""}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          alert(data.error ?? "Unable to update the submission.");
          return;
        }
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  /**
   * Closes a task out without approving it — for work that's finished but was
   * never a review decision. The note keeps the thread honest about who ended it.
   */
  const completeTask = useCallback(
    async (item: FeedItem) => {
      if (!item.task) return;
      setBusyId(item.id);
      try {
        await fetch(`/api/assigned-tasks/${item.task.id}/submissions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_type: "comment", message: "Marked complete" }),
        });
        const moved = await setAssignedTaskStatus({
          assignedTaskId: item.task.id,
          status: "completed",
          vaId: item.user_id,
        });
        if (!moved) {
          alert("The note was recorded but the task status could not be updated.");
        }
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  /** Appends a note to a task's thread. Never edits — that's the whole point. */
  const addNote = useCallback(
    async (item: FeedItem, note: string, attachments?: PendingAttachment[]) => {
      if (!item.task) return;
      setBusyId(item.id);
      try {
        const res = await fetch(`/api/assigned-tasks/${item.task.id}/submissions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_type: "comment", message: note, attachments }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          alert(data.error ?? "Unable to add the note.");
          return;
        }
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  // Clears the unread icon for one task's thread — called when the card is
  // opened. Same RLS the bell already relies on: a viewer may only touch
  // their own rows, so this can go straight from the browser without a
  // dedicated route.
  const markThreadRead = useCallback(
    (taskId: number) => {
      if (!currentUserId || !(unreadByTask[taskId] > 0)) return;
      setUnreadByTask((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      const seen = items
        .filter(
          (i) =>
            (i.task?.id ?? i.assigned_task_id) === taskId &&
            isUnreadCandidate(i, currentUserId)
        )
        .map((i) => ({ user_id: currentUserId, submission_id: i.id }));
      if (seen.length > 0) {
        void supabase
          .from("submission_reads")
          .upsert(seen, { onConflict: "user_id,submission_id", ignoreDuplicates: true })
          .then(({ error }) => {
            if (error) console.error("marking submissions read failed:", error.message);
          });
      }
      // The bell's notification for the same thread is read along with it.
      void supabase
        .from("messages")
        .update({ read: true })
        .eq("target_user_id", currentUserId)
        .eq("assigned_task_id", taskId)
        .eq("read", false)
        .then(({ error }) => {
          if (error) console.error("marking notifications read failed:", error.message);
        });
    },
    [supabase, currentUserId, unreadByTask, items]
  );

  // Narrows to the selected scopes when any are chosen, so picking "Objective"
  // leaves only objectives to choose from rather than every project.
  const projectOptions = useMemo(() => {
    if (scopeFilter.size === 0) return projects;
    const kinds = new Set(Array.from(scopeFilter).filter((s) => s !== "adhoc"));
    if (kinds.size === 0) return [];
    return projects.filter((p) => kinds.has(p.kind));
  }, [projects, scopeFilter]);

  // Account and client narrow the already-fetched rows rather than re-querying:
  // a task names its account directly, and the client is that account's client.
  const visibleItems = useMemo(() => {
    let rows = items;

    // "Work from this VA" is about who submitted it — not about who wrote
    // every row riding along on that thread. See keepQualifyingThreads.
    if (vaFilter.size > 0) {
      rows = keepQualifyingThreads(rows, (r) => vaFilter.has(r.user_id));
    }

    if (scopeFilter.size > 0) {
      rows = rows.filter((r) => {
        const scope = !r.task?.project_id ? "adhoc" : (r.task.project_kind ?? "");
        return scopeFilter.has(scope);
      });
    }

    if (projectFilter.size > 0) {
      rows = rows.filter((r) => r.task?.project_id && projectFilter.has(r.task.project_id));
    }

    if (ownerMode === "mine") {
      rows = keepQualifyingThreads(rows, (r) => r.user_id === currentUserId);
    } else if (ownerMode === "to_me") {
      rows = rows.filter((r) => r.task?.assigned_by === currentUserId);
    }

    if (assignedByFilter.size > 0) {
      rows = rows.filter((r) => r.task?.assigned_by && assignedByFilter.has(r.task.assigned_by));
    }

    // Searches what the card shows and what was written in the submission,
    // so a keyword from a memo finds it as readily as a task name.
    const term = search.trim().toLowerCase();
    if (term) {
      rows = rows.filter((r) =>
        [
          r.task?.task_name,
          r.task?.task_detail,
          r.task?.account,
          r.task?.project_name,
          r.submission_comment,
          r.submission_link,
          r.content,
          r.profiles?.full_name,
          r.profiles?.username,
        ]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(term))
      );
    }

    if (statusFilter.size > 0) {
      rows = rows.filter((r) => {
        if (!r.task) return false;
        const state = reviewState[String(r.task.id)] ?? "awaiting";
        const key =
          state === "approved" && r.task.review_required === false
            ? "auto_approved"
            : state;
        return statusFilter.has(key);
      });
    }

    if (categoryFilter.size > 0) {
      rows = rows.filter((r) => categoryFilter.has((r.task?.category ?? "").trim()));
    }

    if (workTypeFilter.size > 0) {
      rows = rows.filter((r) =>
        workTypeFilter.has(r.task?.is_output_based ? "output_based" : "time_based")
      );
    }

    if (accountFilter.size > 0) {
      rows = rows.filter((r) => r.task?.account && accountFilter.has(r.task.account));
    }

    if (clientFilter.size > 0) {
      // A client can bill several accounts; a row matches if its account is any
      // of the accounts mapped to any selected client.
      const names = new Set<string>();
      for (const clientId of clientFilter) {
        for (const name of accountsByClient.get(clientId) ?? []) names.add(name);
      }
      rows = rows.filter((r) => r.task?.account && names.has(r.task.account));
    }

    // Task's own due date — a task with none set can't match a range, since
    // there's nothing to compare.
    if (taskDateFrom || taskDateTo) {
      rows = rows.filter((r) => {
        const d = r.task?.due_date;
        if (!d) return false;
        if (taskDateFrom && d < taskDateFrom) return false;
        if (taskDateTo && d > taskDateTo) return false;
        return true;
      });
    }

    // When the work was actually turned in, in org time — same conversion
    // Timeline/Calendar already group by (localDay), so this range lines up
    // with what those two views show for the same day. See
    // keepQualifyingThreads: filtering every row by its own created_at
    // (the previous version) made a freshly-added note vanish the moment
    // it was posted outside the window, even on an otherwise-visible
    // thread — the "my note didn't save" report from 2026-09-14.
    if (submissionDateFrom || submissionDateTo) {
      rows = keepQualifyingThreads(rows, (r) => {
        const d = localDay(r.created_at, orgTimezone);
        if (submissionDateFrom && d < submissionDateFrom) return false;
        if (submissionDateTo && d > submissionDateTo) return false;
        return true;
      });
    }

    // A thread's unread count belongs to the task, not to any one row in it —
    // so this checks task membership directly rather than going through
    // keepQualifyingThreads' per-submission predicate.
    if (unreadOnly) {
      rows = rows.filter((r) => {
        const taskId = r.task?.id ?? r.assigned_task_id;
        return taskId != null && (unreadByTask[taskId] ?? 0) > 0;
      });
    }

    return rows;
  }, [items, vaFilter, scopeFilter, projectFilter, workTypeFilter, categoryFilter, accountFilter, clientFilter, accountsByClient, ownerMode, currentUserId, assignedByFilter, statusFilter, reviewState, search, taskDateFrom, taskDateTo, submissionDateFrom, submissionDateTo, orgTimezone, unreadOnly, unreadByTask]);

  // Calendar plots every submission on its own date — a resubmission genuinely
  // happened on its own day, so it gets its own square.
  const itemsByDay = useMemo(() => {
    const map = new Map<string, FeedItem[]>();
    for (const item of visibleItems) {
      // The calendar answers "what was turned in when" — notes and approvals
      // would only crowd the squares.
      if (item.message_type !== "submission") continue;
      const day = localDay(item.created_at, orgTimezone);
      const list = map.get(day) ?? [];
      list.push(item);
      map.set(day, list);
    }
    return map;
  }, [visibleItems, orgTimezone]);

  // Work that is owed, on the day it is owed. Bucketed on due_date itself
  // rather than a converted timestamp — the due date is already the date the
  // team agreed on, and running it through a timezone can only move it.
  const expectedByDay = useMemo(() => {
    const map = new Map<string, FeedItem[]>();
    for (const item of visibleItems) {
      if (item.message_type !== "expected") continue;
      const day = item.task?.due_date;
      if (!day) continue;
      const list = map.get(day) ?? [];
      list.push(item);
      map.set(day, list);
    }
    return map;
  }, [visibleItems]);

  // Which revision round each submission belongs to — its position in its
  // task's thread. The calendar shows loose submissions rather than threads, so
  // each chip needs to carry its own round marker.
  // account name -> client name, the reverse of accountsByClient, so a card
  // can name the client behind the account it already carries.
  const clientByAccount = useMemo(() => {
    const map = new Map<string, ClientRow>();
    for (const [clientId, accountNames] of accountsByClient) {
      const client = clients.find((c) => c.id === clientId);
      if (!client) continue;
      for (const name of accountNames) map.set(name, client);
    }
    return map;
  }, [accountsByClient, clients]);

  // Built from the loaded rows rather than the full staff list, so the filter
  // only ever offers people who actually assigned something here.
  const assignerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items) {
      const id = item.task?.assigned_by;
      if (id && !seen.has(id)) seen.set(id, item.task?.assigned_by_name || "Unknown");
    }
    return Array.from(seen, ([value, label]) => ({ value, label }));
  }, [items]);

  // The thread carries notes and reviews too, so the headline count has to
  // exclude them or it stops meaning "work turned in".
  const submissionCount = useMemo(
    () => visibleItems.filter((i) => i.message_type === "submission").length,
    [visibleItems]
  );

  // Only submissions are numbered — a note or an approval sits between rounds
  // without being one, so counting every entry would inflate the R.
  const roundByItemId = useMemo(() => {
    const byTask = new Map<number, FeedItem[]>();
    for (const item of visibleItems) {
      if (item.message_type !== "submission") continue;
      const key = item.task?.id ?? item.assigned_task_id ?? -item.id;
      byTask.set(key, (byTask.get(key) ?? []).concat(item));
    }
    const map = new Map<number, number>();
    for (const list of byTask.values()) {
      [...list]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .forEach((item, index) => map.set(item.id, index));
    }
    return map;
  }, [visibleItems]);

  // Timeline threads them instead: all submissions for one task form a single
  // card, oldest first, so a resubmission reads as the next entry under the
  // original rather than an unrelated card further down the page.
  const allThreads = useMemo(() => {
    const byTask = new Map<number, FeedItem[]>();
    for (const item of visibleItems) {
      // Expected work has no thread — nothing has been turned in yet.
      if (item.message_type === "expected") continue;
      const key = item.task?.id ?? item.assigned_task_id ?? -item.id;
      const list = byTask.get(key) ?? [];
      list.push(item);
      byTask.set(key, list);
    }

    const threads: Thread[] = Array.from(byTask.entries()).map(([taskId, list]) => {
      const ordered = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
      // The most recent *submission* specifically, matching the sort comment
      // below — a resubmission is new work and should resurface the thread,
      // but a note or an approval isn't work turned in, and bumping the
      // thread to today over one made an old, already-answered task jump to
      // the top of a reviewer's list every time anyone appended a comment.
      // Falls back to the last item of any type only for the edge case of a
      // thread with no submission entry at all.
      const submissionsOnly = ordered.filter((i) => i.message_type === "submission");
      const latest = submissionsOnly[submissionsOnly.length - 1] ?? ordered[ordered.length - 1];
      return { taskId, items: ordered, latest };
    });

    // Newest activity first. A thread sits on the day of its most recent
    // submission, so reworked tasks resurface as current work rather than
    // staying buried on the date they were first submitted.
    threads.sort((a, b) => b.latest.created_at.localeCompare(a.latest.created_at));
    return threads;
  }, [visibleItems]);

  const pageCount = Math.max(1, Math.ceil(allThreads.length / THREADS_PER_PAGE));
  // Filtering down to fewer results than the current page would otherwise
  // leave you staring at an empty page with no obvious way back.
  const safePage = Math.min(page, pageCount - 1);

  const threadsByDay = useMemo(() => {
    const start = safePage * THREADS_PER_PAGE;
    const map = new Map<string, Thread[]>();
    for (const thread of allThreads.slice(start, start + THREADS_PER_PAGE)) {
      const day = localDay(thread.latest.created_at, orgTimezone);
      const list = map.get(day) ?? [];
      list.push(thread);
      map.set(day, list);
    }
    return map;
  }, [allThreads, safePage, orgTimezone]);

  // What "select all" means: every thread on the current page — not every
  // thread matching the filters across every page, which would let one click
  // quietly stage a batch approval of work nobody has actually looked at yet.
  const pageThreadIds = useMemo(
    () => Array.from(threadsByDay.values()).flatMap((list) => list.map((t) => t.taskId)),
    [threadsByDay]
  );
  const allPageSelected =
    pageThreadIds.length > 0 && pageThreadIds.every((id) => selectedTaskIds.has(id));

  const toggleSelectAll = useCallback(() => {
    setSelectedTaskIds((prev) => {
      if (pageThreadIds.length > 0 && pageThreadIds.every((id) => prev.has(id))) {
        const next = new Set(prev);
        for (const id of pageThreadIds) next.delete(id);
        return next;
      }
      return new Set([...prev, ...pageThreadIds]);
    });
  }, [pageThreadIds]);

  /**
   * Approves every selected task that's actually awaiting a decision, in one
   * go. Anything selected that's already been decided (approved, auto-
   * approved, in revision) is silently skipped rather than erroring — a
   * "select all" sweep is expected to catch a mix of states, and forcing the
   * reviewer to hand-deselect the finished ones first would defeat the point.
   * Posts one "approval" row per task, same as clicking Approve on the card,
   * then reloads once at the end rather than after every task.
   */
  const batchApprove = useCallback(async () => {
    const targets = allThreads.filter((t) => {
      if (!selectedTaskIds.has(t.taskId) || !t.latest.task) return false;
      const state = reviewState[String(t.taskId)];
      return state === undefined || state === "awaiting";
    });
    if (targets.length === 0) {
      alert("None of the selected tasks are awaiting review.");
      return;
    }
    const skipped = selectedTaskIds.size - targets.length;
    if (
      !confirm(
        `Approve ${targets.length} task${targets.length === 1 ? "" : "s"}?` +
          (skipped > 0
            ? ` (${skipped} of the selected task${skipped === 1 ? "" : "s"} ${skipped === 1 ? "isn't" : "aren't"} awaiting review and will be skipped.)`
            : "")
      )
    ) {
      return;
    }
    setBatchApproving(true);
    try {
      const failed: string[] = [];
      for (const t of targets) {
        const item = t.latest;
        if (!item.task) continue;
        try {
          const res = await fetch(`/api/assigned-tasks/${item.task.id}/submissions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message_type: "approval",
              message:
                item.task.review_required === false
                  ? "Auto approved — this task does not require review"
                  : REVIEW_DEFAULT_NOTE.approval,
            }),
          });
          if (!res.ok) throw new Error();
          const moved = await setAssignedTaskStatus({
            assignedTaskId: item.task.id,
            status: REVIEW_STATUS.approval,
            vaId: item.user_id,
          });
          if (!moved) throw new Error();
        } catch {
          failed.push(item.task.task_name);
        }
      }
      setSelectedTaskIds(new Set());
      await load();
      if (failed.length > 0) {
        alert(`Approved the rest, but these didn't go through:\n${failed.join("\n")}`);
      }
    } finally {
      setBatchApproving(false);
    }
  }, [allThreads, selectedTaskIds, reviewState, load]);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {/* The subtitle explained the append-only rule, which the Key and the
            thread itself already make obvious — it was costing a line on every
            visit to say something nobody rereads. */}
        <h1 className="text-sm font-bold uppercase tracking-wide text-espresso">
          Work Submitted
        </h1>



        <div className="inline-flex items-center gap-1 rounded-lg border border-sand bg-parchment/40 p-1">
          {(["timeline", "calendar"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setView(mode)}
              className={`rounded-md px-3 py-1 text-[11px] font-semibold capitalize transition-colors ${
                view === mode ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Key sits in the filter bar rather than above it: two full-width
          bordered rows for one button was most of the page's dead space. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-sand bg-white px-3 py-2">
        {detailTaskId !== null && (
        <TaskDetailModal
          taskId={detailTaskId}
          onClose={() => setDetailTaskId(null)}
          canSetDue={canReview}
        />
      )}

      <SubmissionsLegend />

        {/* Whose submissions is a filter like any other, so it sits with them
            rather than as a third tab strip competing with the view toggle. */}
        <select
          value={ownerMode}
          onChange={(e) => setOwnerMode(e.target.value as OwnerMode)}
          className="rounded-lg border border-sand bg-white px-2 py-1 text-[11px] text-espresso outline-none"
        >
          {OWNER_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>

        {/* A quick way to find "did Toni leave me a comment I haven't seen
            yet" without reading every card — the ✉️ badge on a card answers
            "on which one", this answers "is there any at all". */}
        <button
          type="button"
          onClick={() => setUnreadOnly((v) => !v)}
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
            unreadOnly
              ? "border-terracotta/30 bg-terracotta-soft text-terracotta"
              : "border-sand bg-white text-stone hover:border-walnut"
          }`}
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m2 6 10 7 10-7" />
          </svg>
          Unread
          {Object.keys(unreadByTask).length > 0 && (
            <span className="rounded-full bg-terracotta px-1.5 py-[1px] text-[10px] font-bold text-white">
              {Object.keys(unreadByTask).length}
            </span>
          )}
        </button>

        <CardFieldsPicker
          titleField={titleField}
          onTitleChange={(next) => {
            setTitleField(next);
            try {
              if (currentUserId) localStorage.setItem(`mf-submissions-title:${currentUserId}`, next);
            } catch {
              // Unavailable storage — the choice still applies this session.
            }
          }}
          hidden={hiddenFields}
          onToggle={toggleColumnVisible}
        />

        {/* Three groups, lightly ruled apart: what you're looking at, how it's
            narrowed, and the actions. Ten chips in an undivided row read as one
            undifferentiated mass. */}
        <span className="mx-0.5 h-5 w-px shrink-0 bg-sand" aria-hidden="true" />
        {seesAll && (
          <MultiSelectFilter
            allLabel="All VAs"
            selected={vaFilter}
            onChange={setVaFilter}
            options={teamMembers.map((m) => ({ value: m.id, label: m.full_name || m.username }))}
          />
        )}

        <MultiSelectFilter
          allLabel="All work"
          selected={scopeFilter}
          onChange={setScopeFilter}
          options={SCOPE_OPTIONS}
        />

        <MultiSelectFilter
          allLabel="All task types"
          selected={workTypeFilter}
          onChange={setWorkTypeFilter}
          options={WORK_TYPE_OPTIONS}
        />

        <MultiSelectFilter
          allLabel="All projects"
          selected={projectFilter}
          onChange={setProjectFilter}
          options={projectOptions.map((p) => ({ value: p.id, label: p.name }))}
        />

        {/* Admin and above only. Everyone else has the My submissions /
            Submitted to me switch, which covers the same ground for one person. */}
        {canReview && (
          <MultiSelectFilter
            allLabel="All assigners"
            selected={assignedByFilter}
            onChange={setAssignedByFilter}
            options={assignerOptions}
          />
        )}

        <MultiSelectFilter
          allLabel="All statuses"
          selected={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_OPTIONS}
        />

        <MultiSelectFilter
          allLabel="All categories"
          selected={categoryFilter}
          onChange={setCategoryFilter}
          options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: c }))}
        />

        <MultiSelectFilter
          allLabel="All accounts"
          selected={accountFilter}
          onChange={setAccountFilter}
          options={accounts.map((a) => ({ value: a.name, label: a.name }))}
        />

        <MultiSelectFilter
          allLabel="All clients"
          selected={clientFilter}
          onChange={setClientFilter}
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
        />

        <DateRangeChip label="Task date" from={taskDateFrom} to={taskDateTo} onChange={(f, t) => { setTaskDateFrom(f); setTaskDateTo(t); }} />
        <DateRangeChip label="Submission date" from={submissionDateFrom} to={submissionDateTo} onChange={(f, t) => { setSubmissionDateFrom(f); setSubmissionDateTo(t); }} />

        <span className="mx-0.5 h-5 w-px shrink-0 bg-sand" aria-hidden="true" />

        {canReview && (
          <button
            onClick={() => setShowTrash((v) => !v)}
            className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
              showTrash
                ? "border-terracotta/40 bg-terracotta-soft text-terracotta"
                : "border-sand bg-white text-stone hover:text-espresso"
            }`}
          >
            {showTrash ? "Viewing trash" : "Trash"}
          </button>
        )}

        {showTrash && canEmptyTrash && items.length > 0 && (
          <button
            onClick={() => void emptyTrash()}
            className="rounded-lg border border-terracotta/40 bg-terracotta px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-[#a85840]"
          >
            Empty trash
          </button>
        )}

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search submissions..."
          className="ml-auto w-48 rounded-lg border border-sand bg-white px-2 py-1 text-[11px] text-espresso outline-none placeholder:text-stone/60"
        />

        <span className="text-[11px] text-stone">
          {loading ? "Loading..." : `${submissionCount} submission${submissionCount === 1 ? "" : "s"}`}
        </span>
      </div>

      {(canReview && view === "timeline" && pageThreadIds.length > 0) ||
      selectedTaskIds.size > 0 ? (
        <div
          className={`mb-3 flex items-center gap-3 rounded-xl border px-3 py-2 ${
            selectedTaskIds.size > 0
              ? "border-terracotta/30 bg-terracotta-soft"
              : "border-sand bg-white"
          }`}
        >
          {canReview && view === "timeline" && pageThreadIds.length > 0 && (
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-stone">
              <input
                type="checkbox"
                checked={allPageSelected}
                onChange={toggleSelectAll}
                className="cursor-pointer accent-terracotta"
              />
              Select all on this page
            </label>
          )}
          {selectedTaskIds.size > 0 && (
            <>
              <span className="text-[11px] font-semibold text-terracotta">
                {selectedTaskIds.size} selected
              </span>
              {!showTrash && (
                <button
                  onClick={() => void batchApprove()}
                  disabled={batchApproving}
                  className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
                >
                  {batchApproving ? "Approving..." : "Approve selected"}
                </button>
              )}
              <button
                onClick={() => void trashSelected(showTrash)}
                disabled={batchApproving}
                className="rounded-lg bg-terracotta px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:opacity-50"
              >
                {showTrash ? "Restore" : "Move to trash"}
              </button>
              <button
                onClick={() => setSelectedTaskIds(new Set())}
                className="ml-auto text-[10px] font-semibold text-stone transition-colors hover:text-espresso"
              >
                Clear
              </button>
            </>
          )}
        </div>
      ) : null}

      {view === "timeline" && pageCount > 1 && (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-sand bg-white px-3 py-2">
          <span className="text-[11px] text-stone">
            Page {safePage + 1} of {pageCount} · {allThreads.length} task
            {allThreads.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((n) => Math.max(0, n - 1))}
              disabled={safePage === 0}
              className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-40"
            >
              ← Newer
            </button>
            <button
              onClick={() => setPage((n) => Math.min(pageCount - 1, n + 1))}
              disabled={safePage >= pageCount - 1}
              className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-40"
            >
              Older →
            </button>
          </div>
        </div>
      )}

      {view === "timeline" ? (
        <TimelineView
          byDay={threadsByDay}
          orgTimezone={orgTimezone}
          canReview={canReview}
          busyId={busyId}
          onReview={review}
          onAddNote={addNote}
          loading={loading}
          roundDurations={roundDurations}
          reviewState={reviewState}
          showTrash={showTrash}
          selectedTaskIds={selectedTaskIds}
          onSelectChange={handleSelectChange}
          onComplete={completeTask}
          titleField={titleField}
          hiddenFields={hiddenFields}
          clientByAccount={clientByAccount}
          onCancelReversal={cancelReversal}
          onOpenTask={setDetailTaskId}
          unreadByTask={unreadByTask}
          onMarkRead={markThreadRead}
          highlightTaskId={highlightTaskId}
        />
      ) : (
        <CalendarView
          byDay={itemsByDay}
          expectedByDay={expectedByDay}
          anchor={monthAnchor}
          onAnchorChange={setMonthAnchor}
          orgTimezone={orgTimezone}
          roundByItemId={roundByItemId}
          onOpenTask={setDetailTaskId}
        />
      )}
    </div>
  );
}

/**
 * A day's worth of threads, collapsible, with the day's totals on the header
 * so a closed day still says whether anything needs doing.
 */
function DayGroup({
  day,
  orgTimezone,
  threads,
  reviewState,
  children,
}: {
  day: string;
  orgTimezone: string;
  threads: Thread[];
  reviewState: Record<string, string>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  const submissionCount = threads.reduce(
    (n, t) => n + t.items.filter((i) => i.message_type === "submission").length,
    0
  );
  // Matches the cards exactly: anything still awaiting a decision counts.
  // Auto-approved work is already excluded by its state, so testing
  // review_required as well used to hide a reversed auto-approval — the card
  // said Needs review while the day header pretended nothing was waiting.
  const needsReview = threads.filter((t) => {
    const state = reviewState[String(t.taskId)];
    return state === undefined || state === "awaiting";
  }).length;

  return (
    <div className="px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2 text-left"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          className={`shrink-0 text-bark transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-walnut">
          {new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
            timeZone: orgTimezone,
          })}
        </span>
        <span className="text-[10px] text-stone">
          {submissionCount} submission{submissionCount === 1 ? "" : "s"}
        </span>
        {needsReview > 0 && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-[2px] text-[10px] font-semibold text-amber-600">
            {needsReview} need{needsReview === 1 ? "s" : ""} review
          </span>
        )}
      </button>

      {open && <div className="mt-2 space-y-1.5">{children}</div>}
    </div>
  );
}

/**
 * What the markers mean, spelled out once at the top of the page.
 *
 * This is what lets the markers stay terse: "LR2" is unreadable on its own, but
 * with the key in view it carries two facts in four characters, which is what
 * makes them fit in a calendar chip or a table row. Add a row here whenever a
 * new marker is introduced — the legend is the contract.
 */
function SubmissionsLegend() {
  // Collapsed by default. A key is worth reading once and then rarely again,
  // so leaving it open permanently adds noise to every single visit.
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-lg border border-sand bg-parchment/30 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-walnut transition-colors hover:bg-parchment/60"
      >
        Key
        <svg width="8" height="8" viewBox="0 0 12 12" className={`transition-transform ${open ? "rotate-90" : ""}`}>
          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-30 flex w-[34rem] max-w-[80vw] flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-sand bg-white px-3 py-2 shadow-lg">

      <span className="flex items-center gap-1.5 text-[11px] text-stone">
        <RevisionBadge count={1} />
        <RevisionBadge count={2} />
        revision round
      </span>

      <span className="flex items-center gap-1.5 text-[11px] text-stone">
        <RevisionBadge count={0} late />
        <RevisionBadge count={2} late />
        late — after the due date
      </span>

      <span className="flex items-center gap-1.5 text-[11px] text-stone">
        <span
          className={`rounded-full border px-2 py-[2px] text-[10px] font-semibold ${SUBMISSION_TYPE_BADGE.submission}`}
        >
          Submission
        </span>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-[2px] text-[10px] font-semibold text-amber-600">
          Resubmission
        </span>
        original vs rework
      </span>

      {/* Calendar-only colours. They answer a different question from the
          review pills below — not what the reviewer decided, but whether the
          work landed by its deadline — so they get their own row. */}
      <span className="flex w-full items-center gap-1.5 text-[11px] text-stone">
        {(["on_time", "late_same_day", "late_other_day", "no_deadline"] as const).map((key) => (
          <span
            key={key}
            className={`rounded border px-2 py-[2px] text-[10px] font-semibold ${TIMELINESS_CHIP[key]}`}
          >
            {TIMELINESS_LABEL[key]}
          </span>
        ))}
        calendar chips
      </span>

      <span className="flex w-full items-center gap-1.5 text-[11px] text-stone">
        <span
          className={`rounded border px-2 py-[2px] text-[10px] font-semibold opacity-60 ${TIMELINESS_CHIP.on_time}`}
        >
          Faded
        </span>
        auto approved — listed beneath the day&apos;s review queue
      </span>

      <span className="flex w-full items-center gap-1.5 text-[11px] text-stone">
        <span className={`rounded border px-2 py-[2px] text-[10px] font-semibold ${EXPECTED_CHIP}`}>
          Due
        </span>
        <span className={`rounded border px-2 py-[2px] text-[10px] font-semibold ${MISSED_CHIP}`}>
          Missed
        </span>
        waiting on the work — blue until it lands, terracotta once the day has passed
      </span>

      <span className="flex items-center gap-1.5 text-[11px] text-stone">
        {(["awaiting", "revision_requested", "approved", "auto_approved"] as const).map((key) => (
          <span
            key={key}
            className={`rounded-full border px-2 py-[2px] text-[10px] font-semibold ${REVIEW_STATE_PILL[key].className}`}
          >
            {REVIEW_STATE_PILL[key].label}
          </span>
        ))}
      </span>
        </div>
      )}
    </div>
  );
}

/**
 * Title and detail lines in one control. They are the same decision — what
 * this card should say — so splitting them across two dropdowns made the
 * filter bar wider and the relationship between them invisible.
 */
function CardFieldsPicker({
  titleField,
  onTitleChange,
  hidden,
  onToggle,
}: {
  titleField: TitleField;
  onTitleChange: (next: TitleField) => void;
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const shown = CARD_FIELDS.length - hidden.size;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-sand bg-white px-2 py-1 text-[11px] text-espresso outline-none transition-colors hover:border-walnut"
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="18" rx="1" />
          <rect x="14" y="3" width="7" height="18" rx="1" />
        </svg>
        Fields
        <span className="rounded-full bg-terracotta px-1.5 py-px text-[10px] font-bold leading-none text-white">
          {shown}
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-9 z-30 w-60 rounded-lg border border-sand bg-white p-2 shadow-lg">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-walnut">
            Title
          </label>
          <select
            value={titleField}
            onChange={(e) => onTitleChange(e.target.value as TitleField)}
            className="mb-2 w-full rounded-lg border border-sand bg-white px-2 py-1 text-[12px] text-espresso outline-none"
          >
            {TITLE_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>

          <div className="my-1 border-t border-parchment" />
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-walnut">
            Also show
          </label>
          {CARD_FIELDS.map((col) => (
            <label
              key={col.key}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[12px] text-espresso hover:bg-parchment"
            >
              <input
                type="checkbox"
                checked={!hidden.has(col.key)}
                onChange={() => onToggle(col.key)}
                className="cursor-pointer accent-terracotta"
              />
              <span className="truncate">{col.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** One entry inside a thread — the original submission, or a resubmission. */
function SubmissionEntry({
  item,
  index,
  thread,
  roundMs,
  timezone,
  canCancel,
  onCancelReversal,
}: {
  item: FeedItem;
  index: number;
  /** The whole thread, so a submission is judged against the deadline that
   *  applied when it landed rather than whatever the task says now. */
  thread: FeedItem[];
  /** Time logged during this revision round, if any was tracked. */
  roundMs?: number;
  timezone: string;
  canCancel: boolean;
  onCancelReversal: (item: FeedItem) => void;
}) {
  const who = item.profiles?.full_name || item.profiles?.username || "Unknown";
  const time = new Date(item.created_at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  // Reviews and notes are events between rounds, not work turned in — they read
  // as a single line so the submissions stay the backbone of the thread. A
  // note or revision request can still carry a screenshot or file though, so
  // that gets its own row underneath rather than being dropped.
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
          <span className="min-w-0 text-[11px] leading-snug text-espresso">
            {item.submission_comment?.trim() || item.content}
            <span className="ml-1 text-[10px] text-stone/80">
              — {who} · {time}
            </span>
          </span>

          {/* A reversal clicked by mistake shouldn't mark the record forever.
              Cancelling trashes the entry, so the row survives with deleted_at
              while the thread reads as though it never happened. */}
          {canCancel && type === "approval_reversed" && (
            <button
              onClick={() => onCancelReversal(item)}
              className="shrink-0 text-[10px] font-semibold text-stone transition-colors hover:text-terracotta"
              title="Cancel this reversal and restore the approval"
            >
              Cancel
            </button>
          )}
        </div>

        {item.attachments.length > 0 && (
          <div className="pl-1">
            <AttachmentGallery attachments={item.attachments} />
          </div>
        )}
      </div>
    );
  }

  const isResubmission = index > 0;
  const late = isLate(item, timezone, thread);

  return (
    <div
      className={
        isResubmission
          ? "border-l-2 border-sand pl-3 pt-2"
          : "pt-1"
      }
    >
      <div className="flex items-center gap-1.5">
        {/* Amber for a resubmission so rework is identifiable at a glance
            against the sky-blue of an original submission. */}
        <span
          className={`rounded-full border px-2 py-[2px] text-[10px] font-semibold ${
            isResubmission
              ? "bg-amber-50 text-amber-600 border-amber-200"
              : SUBMISSION_TYPE_BADGE.submission
          }`}
        >
          {isResubmission ? "Resubmission" : "Submission"}
        </span>
        {/* One marker carries both facts: "L" for late, "R2" for the round.
            See the legend at the top of the page. */}
        <RevisionBadge count={index} late={late === true} />
        <span className="text-[10px] text-stone/80">
          {who} · {time}
        </span>
        {late === false && (
          <span
            className="rounded-full border border-sage/20 bg-sage-soft px-2 py-[2px] text-[10px] font-semibold text-sage"
            title={`Due ${deadlineFor(item.task, timezone)}`}
          >
            On time
          </span>
        )}
        {roundMs != null && roundMs > 0 && (
          <span
            className="rounded-full border border-sand bg-parchment/60 px-2 py-[2px] text-[10px] font-semibold text-walnut"
            title={
              index === 0
                ? "Time logged before this was first submitted"
                : `Time logged reworking this after revision ${index}`
            }
          >
            {formatDuration(roundMs)}
          </span>
        )}
      </div>

      {/* Capped with its own scroll: a write-up can run to twenty lines, and at
          full height one entry pushes every other submission off the screen. */}
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

      {item.attachments.length > 0 && <AttachmentGallery attachments={item.attachments} />}
    </div>
  );
}

/**
 * Images become a thumbnail strip that opens full size in a lightbox.
 * Everything else is a link — plus a Preview button for an HTML file:
 * Supabase deliberately serves an uploaded .html file as text/plain when it's
 * opened directly (a platform-wide security measure against stored-page
 * abuse, not something fixable at upload — see the Sept 2026 boss report).
 * Preview re-fetches the same bytes with fetch(), which reads the body as
 * text regardless of what content-type the response claims, and renders them
 * in a fully sandboxed iframe — no scripts, no same-origin, no forms — so
 * showing exactly what a VA uploaded is safe even before anyone's reviewed it.
 */
function AttachmentGallery({ attachments }: { attachments: TaskSubmissionAttachment[] }) {
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);
  const [previewFile, setPreviewFile] = useState<TaskSubmissionAttachment | null>(null);

  if (attachments.length === 0) return null;

  const images = attachments.filter((f) => (f.mime_type ?? "").startsWith("image/") && f.url);
  const others = attachments.filter((f) => !images.includes(f));

  return (
    <div className="mt-1.5 space-y-1.5">
      {images.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {images.map((file, i) => (
            <button
              key={file.id}
              type="button"
              onClick={() =>
                setLightbox({ urls: images.map((f) => f.url as string), index: i })
              }
              title={file.filename}
              className="shrink-0 overflow-hidden rounded border border-sand transition-all hover:border-terracotta"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={file.url as string}
                alt={file.filename}
                loading="lazy"
                className="h-[72px] w-[96px] object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {others.map((file) => {
            const isHtml =
              (file.mime_type ?? "").includes("html") || /\.html?$/i.test(file.filename);
            return (
              <span key={file.id} className="inline-flex items-center gap-1">
                <a
                  href={file.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-sand bg-cream/40 px-2 py-1 text-[11px] text-terracotta hover:bg-cream"
                >
                  {file.filename}
                </a>
                {isHtml && file.url && (
                  <button
                    type="button"
                    onClick={() => setPreviewFile(file)}
                    className="rounded-lg border border-sand bg-white px-2 py-1 text-[11px] font-semibold text-espresso transition-colors hover:bg-cream"
                  >
                    Preview
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {lightbox && (
        <ScreenshotLightbox
          urls={lightbox.urls}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}

      {previewFile && <HtmlPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
    </div>
  );
}

/** Fetches an attachment's bytes (bypassing whatever content-type the
 *  storage response claims) and renders them in a fully sandboxed iframe —
 *  scripts, forms, and same-origin access are all disabled, so this is safe
 *  to open on a file nobody's reviewed yet. */
function HtmlPreviewModal({
  file,
  onClose,
}: {
  file: TaskSubmissionAttachment;
  onClose: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // Only ever runs once per mount — the parent unmounts this modal on
    // close, so there's no case where `file` changes under a mounted
    // instance and the initial useState values need resetting here.
    let cancelled = false;
    fetch(file.url as string)
      .then((res) => {
        if (!res.ok) throw new Error(`Couldn't load the file (${res.status}).`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setHtml(text);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the file.");
      });
    return () => {
      cancelled = true;
    };
  }, [file.url]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-sand bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-sand px-4 py-2.5">
          <span className="truncate text-[12px] font-semibold text-espresso">{file.filename}</span>
          <div className="flex items-center gap-3">
            <a
              href={file.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-semibold text-terracotta hover:underline"
            >
              Download
            </a>
            <button
              onClick={onClose}
              className="text-stone hover:text-espresso"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex-1 bg-cream/40">
          {error ? (
            <p className="p-4 text-[12px] text-terracotta">{error}</p>
          ) : html === null ? (
            <p className="p-4 text-[12px] text-stone">Loading preview...</p>
          ) : (
            <iframe
              title={file.filename}
              srcDoc={html}
              sandbox=""
              className="h-full w-full border-0 bg-white"
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One task's whole submission history as a single card: the original, then each
 * resubmission nested beneath it. A reworked task stays one record here rather
 * than scattering into unrelated cards down the page.
 */
function ThreadCard({
  thread,
  canReview,
  busy,
  onReview,
  onAddNote,
  rounds,
  state,
  timezone,
  trashed,
  selected,
  onSelectChange,
  onComplete,
  titleField,
  hiddenFields,
  clientByAccount,
  onCancelReversal,
  onOpenTask,
  unreadCount = 0,
  onMarkRead,
  autoExpand = false,
}: {
  thread: Thread;
  canReview: boolean;
  busy: boolean;
  onReview: (
    item: FeedItem,
    outcome: ReviewOutcome,
    note?: string,
    dueAt?: string,
    attachments?: PendingAttachment[]
  ) => void;
  onAddNote: (item: FeedItem, note: string, attachments?: PendingAttachment[]) => void;
  /** round index -> ms logged during that round. */
  rounds: Record<string, number>;
  /** "awaiting" | "revision_requested" | "approved" */
  state?: string;
  timezone: string;
  trashed: boolean;
  selected: boolean;
  onSelectChange: (taskId: number, checked: boolean) => void;
  onComplete: (item: FeedItem) => void;
  titleField: TitleField;
  hiddenFields: Set<string>;
  clientByAccount: Map<string, ClientRow>;
  onCancelReversal: (item: FeedItem) => void;
  onOpenTask: (taskId: number) => void;
  /** Unread comments on this thread for the current viewer. */
  unreadCount?: number;
  onMarkRead?: (taskId: number) => void;
  /** Arrived here via a notification link — start expanded and scroll into view. */
  autoExpand?: boolean;
}) {
  // Notes and reviews live in the thread too, but the submissions are what the
  // numbering, the rounds and the review actions all key off.
  const submissions = thread.items.filter((i) => i.message_type === "submission");
  const head = submissions[0] ?? thread.items[0];
  const latest = submissions[submissions.length - 1] ?? thread.latest;
  const resubmissions = Math.max(0, submissions.length - 1);
  const submissionIndex = new Map(submissions.map((s, i) => [s.id, i]));

  const [expanded, setExpanded] = useState(autoExpand);
  const cardRef = useRef<HTMLDivElement>(null);

  // Landed here from a notification: scroll it into view and clear the
  // unread badge, same as opening the thread by hand would.
  useEffect(() => {
    if (!autoExpand) return;
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    onMarkRead?.(thread.taskId);
    // Runs once for the card this notification pointed at — re-firing on
    // every unrelated re-render would keep re-scrolling the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const client = head.task?.account ? clientByAccount.get(head.task.account) : undefined;

  // One place decides what every field says, so the title and the detail
  // lines can never disagree about the same field.
  const totalMs = Object.values(rounds).reduce((sum, ms) => sum + ms, 0);

  const fieldValue = (key: string): string | null => {
    switch (key) {
      case "task":
        return head.task?.task_name ?? null;
      case "account":
        return head.task?.account ?? null;
      case "client":
        return client?.name ?? null;
      case "client_detail":
        // The task editor's Client Detail — assigned_tasks.task_detail, the
        // text that carries over to the client memo. Not the client profile's
        // contact information, which is a different thing under a similar name.
        return head.task?.task_detail ?? null;
      case "message":
        // What the VA wrote when submitting. Belongs to the submission, not
        // the task, so a thread with resubmissions has several — the first
        // one is what a single-line card can carry.
        return head.submission_comment?.trim() || null;
      case "project":
        return head.task?.project_name ?? null;
      case "reviewer":
        return head.task?.assigned_by_name ? `reviewer: ${head.task.assigned_by_name}` : null;
      case "category":
        return head.task?.category ?? null;
      case "submitter":
        return head.profiles?.full_name || head.profiles?.username || null;
      case "total_time":
        return totalMs > 0 ? formatDuration(totalMs) : null;
      case "count":
        return expanded
          ? null
          : `${thread.items.length} submission${thread.items.length === 1 ? "" : "s"}`;
      default:
        return null;
    }
  };

  // Chosen field, then the submission's own message, then the task name. A
  // card is never headed by a blank, and an empty Client Detail falls to what
  // the person actually wrote when submitting rather than to a task name that
  // is the same on every card of that kind.
  const cardTitle =
    fieldValue(titleField) ??
    head.submission_comment?.trim() ??
    head.task?.task_name ??
    "Task removed";

  // The field used as the title is skipped here — printing it twice on one
  // card is never what was wanted.
  const metaLine = CARD_FIELDS.filter(
    (f) => !hiddenFields.has(f.key) && f.key !== titleField
  )
    .map((f) => fieldValue(f.key))
    .filter(Boolean)
    .join(" · ");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteMode, setNoteMode] = useState<null | "revision" | "note">(null);
  const [revisionDue, setRevisionDue] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);

  // Attach-by-paste/drag/upload on a note or revision request, same flow
  // SubmitWorkModal uses: files go straight to storage via a signed slot, and
  // only their paths ride along in the JSON body that posts the note.
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const [noteUploading, setNoteUploading] = useState(false);
  const [noteUploadError, setNoteUploadError] = useState("");
  const [noteProgress, setNoteProgress] = useState("");
  const [noteDragActive, setNoteDragActive] = useState(false);
  const noteDragCounter = useRef(0);
  const noteSupabase = useMemo(() => createClient(), []);

  const appendNoteFiles = (picked: File[]) => {
    if (picked.length === 0) return;
    setNoteFiles((prev) => [...prev, ...picked]);
  };
  const addNoteFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    appendNoteFiles(Array.from(list));
  };
  const removeNoteFile = (index: number) => {
    setNoteFiles((prev) => prev.filter((_, i) => i !== index));
  };
  const handleNoteDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    noteDragCounter.current += 1;
    setNoteDragActive(true);
  };
  const handleNoteDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    noteDragCounter.current -= 1;
    if (noteDragCounter.current <= 0) {
      noteDragCounter.current = 0;
      setNoteDragActive(false);
    }
  };
  const handleNoteDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleNoteDrop = (e: React.DragEvent) => {
    e.preventDefault();
    noteDragCounter.current = 0;
    setNoteDragActive(false);
    if (busy || noteUploading) return;
    appendNoteFiles(Array.from(e.dataTransfer.files ?? []));
  };
  // Only intercepted when the clipboard actually carries a file (a screenshot
  // copied in) — a plain text paste into the textarea is left alone.
  const handleNotePaste = (e: React.ClipboardEvent) => {
    if (busy || noteUploading) return;
    const fromFiles = Array.from(e.clipboardData?.files ?? []);
    const fromItems = Array.from(e.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    const picked = fromFiles.length > 0 ? fromFiles : fromItems;
    if (picked.length === 0) return;
    e.preventDefault();
    appendNoteFiles(picked);
  };

  /** Uploads any attached files, then posts the note or revision request. */
  const submitNote = async () => {
    const note = noteDraft.trim();
    const taskId = latest.task?.id;
    if (!taskId) return;
    if (noteMode === "revision" ? !note : !note && noteFiles.length === 0) return;

    setNoteUploadError("");
    setNoteUploading(true);
    try {
      const attachments: PendingAttachment[] = [];
      for (const [index, file] of noteFiles.entries()) {
        setNoteProgress(`Uploading ${index + 1} of ${noteFiles.length}...`);
        const slotRes = await fetch(`/api/assigned-tasks/${taskId}/submissions/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, size: file.size }),
        });
        if (!slotRes.ok) {
          const body = await slotRes.json().catch(() => ({}));
          setNoteUploadError(body.error ?? `Couldn't upload ${file.name}.`);
          return;
        }
        const { path, token } = await slotRes.json();
        const { error: uploadError } = await noteSupabase.storage
          .from("task-attachments")
          .uploadToSignedUrl(path, token, file);
        if (uploadError) {
          setNoteUploadError(`Couldn't upload ${file.name}: ${uploadError.message}`);
          return;
        }
        attachments.push({
          path,
          filename: file.name,
          size: file.size,
          mime_type: file.type || null,
        });
      }
      setNoteProgress("");

      if (noteMode === "revision") {
        onReview(
          latest,
          "revision",
          note,
          revisionDue ? new Date(revisionDue).toISOString() : undefined,
          attachments.length > 0 ? attachments : undefined
        );
      } else {
        onAddNote(latest, note, attachments.length > 0 ? attachments : undefined);
      }
      setNoteDraft("");
      setRevisionDue("");
      setNoteFiles([]);
      setNoteMode(null);
    } finally {
      setNoteProgress("");
      setNoteUploading(false);
    }
  };

  // Whole-task effort: every round summed. Grows with each resubmission, while
  // each entry below keeps its own round's figure.
  // Unknown state falls through to "awaiting" — better to offer the buttons
  // than to hide a decision that still needs making.
  // Allow-list, not a deny-list: listing the states that DON'T need review
  // meant every new state (completed, and anything added later) silently fell
  // through as "needs review" and showed Approve/Revise on finished work.
  const awaitingReview = state === undefined || state === "awaiting";
  // An approval on a task that never required review is labelled as such, so
  // "Approved" always means a person actually looked at it.
  const autoApproved = state === "approved" && latest.task?.review_required === false;
  const pill = autoApproved
    ? REVIEW_STATE_PILL.auto_approved
    : state
      ? REVIEW_STATE_PILL[state]
      : undefined;

  return (
    <div ref={cardRef} className="rounded-lg border border-sand bg-white px-3 py-2.5">
      {/* Task Name | R# Task Type | Total time | Approve Revise */}
      <div className="flex items-center gap-2">
        {/* Selection drives the bulk trash action. One checkbox per card beats
            a Trash link on every row, which was noise on rows nobody was binning. */}
        {canReview && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelectChange(thread.taskId, e.target.checked)}
            className="shrink-0 cursor-pointer accent-terracotta"
            aria-label="Select this task's submissions"
          />
        )}
        <button
          type="button"
          onClick={() => {
            // Read from the state variable, not from inside setExpanded's
            // updater — calling onMarkRead (another component's setState)
            // from within an updater fires React's "Cannot update a
            // component while rendering a different component" warning, and
            // can drop the update it triggers.
            if (!expanded) onMarkRead?.(thread.taskId);
            setExpanded((v) => !v);
          }}
          className="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 12 12"
            className={`shrink-0 text-bark transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            <path
              d="M4 2l4 4-4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="truncate text-[13px] font-semibold leading-tight text-espresso transition-colors group-hover:text-terracotta">
            {cardTitle}
          </span>
          <RevisionBadge count={resubmissions} />
          <span className="shrink-0 rounded-full border border-stone/20 bg-stone/10 px-2 py-[2px] text-[10px] font-semibold text-stone">
            {scopeLabel(head)}
          </span>
        </button>

        {/* Straight into the real task editor rather than a second copy of it
            embedded here. Outside the collapse button so it isn't a nested. */}
        {head.task && (
          <button
            onClick={() => onOpenTask(head.task!.id)}
            className="shrink-0 text-[10px] font-semibold text-stone transition-colors hover:text-terracotta"
            title="View the full task without leaving this page"
          >
            View task
          </button>
        )}

        {totalMs > 0 && !hiddenFields.has("total_time") && titleField !== "total_time" && (
          <span
            className="shrink-0 text-[11px] font-semibold tabular-nums text-walnut"
            title="Total time logged on this task across every round"
          >
            {formatDuration(totalMs)}
          </span>
        )}

        {/* Buttons exist only while there's a decision to make. Once reviewed,
            the pill states the outcome and there's nothing left to click. */}
        {canReview && latest.task && awaitingReview ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {/* A task that never required review can't be 'approved' by a
                person without implying it was graded — this stays a single
                button rather than going through the two-gate modal below,
                since there's nothing here for a reviewer to judge. */}
            {latest.task?.review_required === false ? (
              <button
                onClick={() =>
                  onReview(latest, "approval", "Auto approved — this task does not require review")
                }
                disabled={busy}
                className="rounded-lg bg-sage px-2.5 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
              >
                Auto approve
              </button>
            ) : (
              <button
                onClick={() => setReviewOpen(true)}
                disabled={busy}
                className="rounded-lg bg-sage px-2.5 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
              >
                Review
              </button>
            )}
            <button
              onClick={() => onComplete(latest)}
              disabled={busy}
              className="rounded-lg bg-stone/10 px-2.5 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50"
              title="Close this out without an approval decision"
            >
              Complete
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5">
            {pill && (
              <span
                className={`rounded-full border px-2 py-[2px] text-[10px] font-semibold ${pill.className}`}
              >
                {pill.label}
              </span>
            )}
            {/* An auto-approved task was never actually looked at — Undo alone
                just puts it back in the queue, so a reviewer who already knows
                it needs rework would have to Undo, then find Revise, then
                write the same note in two trips. Flag does both in one: undo
                the auto-approval and open the same revision-request form used
                everywhere else, appended the same way. */}
            {canReview && latest.task && autoApproved && (
              <button
                onClick={() => {
                  onReview(latest, "approval_reversed");
                  setNoteMode("revision");
                  setExpanded(true);
                }}
                disabled={busy}
                className="rounded-lg bg-stone/10 px-2.5 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50"
                title="Undo the auto-approval and request changes"
              >
                Flag
              </button>
            )}
            {/* Approving by mistake shouldn't be a dead end. The reversal is
                appended, so the original approval stays in the record. */}
            {canReview && latest.task && state === "approved" && (
              <button
                onClick={() => onReview(latest, "approval_reversed")}
                disabled={busy}
                className="rounded-lg bg-stone/10 px-2.5 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50"
              >
                Undo
              </button>
            )}
          </div>
        )}

        {unreadCount > 0 && (
          <span
            className="flex shrink-0 items-center gap-1 rounded-full border border-terracotta/30 bg-terracotta-soft px-1.5 py-[2px] text-[10px] font-semibold text-terracotta"
            title={`${unreadCount} unread`}
            aria-label={`${unreadCount} unread`}
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m2 6 10 7 10-7" />
            </svg>
            {unreadCount}
          </span>
        )}
      </div>

      {metaLine && (
        <div className="mt-0.5 pl-[18px] text-[11px] text-stone/80">{metaLine}</div>
      )}

      {expanded && (
        <div className="mt-1 space-y-1">
          {thread.items.map((item) => {
            const idx = submissionIndex.get(item.id) ?? 0;
            return (
              <SubmissionEntry
                key={item.id}
                item={item}
                index={idx}
                thread={thread.items}
                roundMs={item.message_type === "submission" ? rounds[String(idx)] : undefined}
                timezone={timezone}
                canCancel={canReview}
                onCancelReversal={onCancelReversal}
              />
            );
          })}

          {noteMode ? (
            <div
              onDragEnter={handleNoteDragEnter}
              onDragLeave={handleNoteDragLeave}
              onDragOver={handleNoteDragOver}
              onDrop={handleNoteDrop}
              className={`relative mt-2 rounded-lg border bg-cream/40 p-2 transition-colors ${
                noteDragActive ? "border-terracotta" : "border-sand"
              }`}
            >
              {noteDragActive && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-terracotta bg-terracotta-soft/40">
                  <p className="text-[11px] font-semibold text-terracotta">Drop to attach</p>
                </div>
              )}
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-walnut">
                Add a note
              </label>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onPaste={handleNotePaste}
                rows={2}
                autoFocus
                placeholder="Anything to add — this is appended, nothing is overwritten"
                className="w-full resize-none rounded-lg border border-sand bg-white px-2 py-1.5 text-xs text-espresso outline-none"
              />

              <div className="mt-1.5">
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-walnut">
                  Attachment
                </label>
                <input
                  type="file"
                  multiple
                  onChange={(e) => {
                    addNoteFiles(e.target.files);
                    e.target.value = "";
                  }}
                  disabled={noteUploading}
                  className="block w-full text-[10px] text-stone file:mr-2 file:rounded-lg file:border-0 file:bg-parchment file:px-2 file:py-1 file:text-[10px] file:font-semibold file:text-espresso hover:file:bg-sand disabled:opacity-50"
                />
                <p className="mt-0.5 text-[10px] text-stone/70">
                  or drag a file onto this box, or paste a screenshot (Ctrl/Cmd+V)
                </p>
                {noteFiles.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {noteFiles.map((file, i) => (
                      <div
                        key={`${file.name}-${i}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-sand bg-white px-2 py-1"
                      >
                        <span className="truncate text-[11px] text-espresso">{file.name}</span>
                        <button
                          onClick={() => removeNoteFile(i)}
                          disabled={noteUploading}
                          className="shrink-0 text-[10px] font-semibold text-terracotta hover:underline disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {noteMode === "revision" && (
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
                  <p className="mt-0.5 text-[10px] text-stone">
                    Moves the task&apos;s due date so the calendar shows what&apos;s expected.
                    Earlier submissions keep the deadline they were judged against.
                  </p>
                </div>
              )}

              {noteProgress && !noteUploadError && (
                <p className="mt-1.5 text-[10px] text-stone">{noteProgress}</p>
              )}
              {noteUploadError && (
                <p className="mt-1.5 text-[10px] text-terracotta">{noteUploadError}</p>
              )}

              <div className="mt-1.5 flex items-center gap-2">
                <button
                  onClick={submitNote}
                  disabled={
                    busy ||
                    noteUploading ||
                    (noteMode === "revision"
                      ? !noteDraft.trim()
                      : !noteDraft.trim() && noteFiles.length === 0)
                  }
                  className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
                >
                  {noteUploading
                    ? "Saving..."
                    : noteMode === "revision"
                      ? "Request Revision"
                      : "Add Note"}
                </button>
                <button
                  onClick={() => {
                    setNoteMode(null);
                    setNoteDraft("");
                    setNoteFiles([]);
                    setNoteUploadError("");
                  }}
                  disabled={busy || noteUploading}
                  className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setNoteMode("note")}
              className="mt-1 text-[10px] font-semibold text-stone transition-colors hover:text-espresso"
            >
              + Add note
            </button>
          )}
        </div>
      )}

      {reviewOpen && latest.task && (
        <ReviewModal
          submission={latest}
          busy={busy}
          onReview={(outcome, note, dueAt, attachments) => {
            onReview(latest, outcome, note, dueAt, attachments);
            setReviewOpen(false);
          }}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
}

function TimelineView({
  byDay,
  orgTimezone,
  canReview,
  busyId,
  onReview,
  onAddNote,
  loading,
  roundDurations,
  reviewState,
  showTrash,
  selectedTaskIds,
  onSelectChange,
  onComplete,
  titleField,
  hiddenFields,
  clientByAccount,
  onCancelReversal,
  onOpenTask,
  unreadByTask,
  onMarkRead,
  highlightTaskId,
}: {
  byDay: Map<string, Thread[]>;
  orgTimezone: string;
  canReview: boolean;
  busyId: number | null;
  onReview: (
    item: FeedItem,
    outcome: ReviewOutcome,
    note?: string,
    dueAt?: string,
    attachments?: PendingAttachment[]
  ) => void;
  onAddNote: (item: FeedItem, note: string, attachments?: PendingAttachment[]) => void;
  loading: boolean;
  roundDurations: Record<string, Record<string, number>>;
  reviewState: Record<string, string>;
  showTrash: boolean;
  selectedTaskIds: Set<number>;
  onSelectChange: (taskId: number, checked: boolean) => void;
  onComplete: (item: FeedItem) => void;
  titleField: TitleField;
  hiddenFields: Set<string>;
  clientByAccount: Map<string, ClientRow>;
  onCancelReversal: (item: FeedItem) => void;
  onOpenTask: (taskId: number) => void;
  /** taskId -> unread comment count for the current viewer. */
  unreadByTask: Record<number, number>;
  onMarkRead: (taskId: number) => void;
  /** The task a notification click pointed at — auto-expanded and scrolled
   *  into view, once. */
  highlightTaskId: number | null;
}) {
  const days = Array.from(byDay.keys()).sort((a, b) => b.localeCompare(a));

  if (loading) return <p className="text-[12px] text-stone">Loading submissions...</p>;
  if (days.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white p-6 text-center">
        <p className="text-[12px] text-stone/70">No submissions match these filters yet.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-sand overflow-hidden rounded-xl border border-sand bg-white">
      {days.map((day) => (
        <DayGroup
          key={day}
          day={day}
          orgTimezone={orgTimezone}
          threads={byDay.get(day) ?? []}
          reviewState={reviewState}
        >
            {(byDay.get(day) ?? []).map((thread) => (
              <ThreadCard
                key={thread.taskId}
                thread={thread}
                canReview={canReview}
                busy={busyId === thread.latest.id}
                onReview={onReview}
                onAddNote={onAddNote}
                rounds={roundDurations[String(thread.taskId)] ?? {}}
                state={reviewState[String(thread.taskId)]}
                timezone={orgTimezone}
                trashed={showTrash}
                selected={selectedTaskIds.has(thread.taskId)}
                onSelectChange={onSelectChange}
                onComplete={onComplete}
                titleField={titleField}
                hiddenFields={hiddenFields}
                clientByAccount={clientByAccount}
                onCancelReversal={onCancelReversal}
                onOpenTask={onOpenTask}
                unreadCount={unreadByTask[thread.taskId] ?? 0}
                onMarkRead={onMarkRead}
                autoExpand={highlightTaskId === thread.taskId}
              />
            ))}
        </DayGroup>
      ))}
    </div>
  );
}
/** How much of the calendar is on screen at once. */
type CalendarScale = "month" | "week" | "day" | "custom";

/** Local YYYY-MM-DD for a Date, with no timezone conversion applied. */
function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function parseDayKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

function shiftDays(d: Date, days: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

/** A custom range wider than this is a scrolling wall, not a calendar. */
const MAX_CUSTOM_DAYS = 92;

/** Chips a day square shows before collapsing the rest behind "+N more". */
const CHIP_LIMIT: Record<CalendarScale, number> = {
  month: 3,
  week: 8,
  day: 60,
  custom: 4,
};

const CELL_HEIGHT: Record<CalendarScale, string> = {
  month: "min-h-[76px]",
  week: "min-h-[170px]",
  day: "min-h-[240px]",
  custom: "min-h-[110px]",
};

function CalendarView({
  byDay,
  expectedByDay,
  anchor,
  onAnchorChange,
  orgTimezone,
  roundByItemId,
  onOpenTask,
}: {
  byDay: Map<string, FeedItem[]>;
  /** Tasks due that day with nothing turned in yet. */
  expectedByDay: Map<string, FeedItem[]>;
  anchor: Date;
  onAnchorChange: (d: Date) => void;
  orgTimezone: string;
  roundByItemId: Map<number, number>;
  onOpenTask: (taskId: number) => void;
}) {
  const [scale, setScale] = useState<CalendarScale>("month");
  const [customStart, setCustomStart] = useState(() => dayKey(anchor));
  const [customEnd, setCustomEnd] = useState(() => dayKey(shiftDays(anchor, 13)));
  // Which day squares the reader has opened up past the chip limit.
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const toggleExpanded = (day: string) =>
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });

  // Every scale renders the same seven-column grid, so all any of them has to
  // produce is the list of days plus however many blanks align the first one
  // under its weekday. Day view is the exception: one square, full width.
  const { cells, label } = useMemo(() => {
    const pad = (count: number) => Array.from({ length: count }, () => null);

    if (scale === "day") {
      return {
        cells: [{ day: dayKey(anchor), date: anchor.getDate() }] as Array<
          { day: string; date: number } | null
        >,
        label: anchor.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
      };
    }

    if (scale === "week") {
      const start = shiftDays(anchor, -anchor.getDay());
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = shiftDays(start, i);
        return { day: dayKey(d), date: d.getDate() };
      });
      const end = shiftDays(start, 6);
      const from = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      // Hand-built rather than a second toLocaleDateString: asking Intl for
      // day + year alone renders "2026 (day: 22)".
      const to =
        start.getMonth() === end.getMonth()
          ? `${end.getDate()}, ${end.getFullYear()}`
          : `${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${end.getFullYear()}`;
      return {
        cells: days as Array<{ day: string; date: number } | null>,
        label: `${from} – ${to}`,
      };
    }

    if (scale === "custom") {
      const start = parseDayKey(customStart);
      const end = parseDayKey(customEnd);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
        return { cells: [] as Array<{ day: string; date: number } | null>, label: "Pick a range" };
      }
      const span = Math.min(
        Math.round((end.getTime() - start.getTime()) / 86400000) + 1,
        MAX_CUSTOM_DAYS
      );
      const days = Array.from({ length: span }, (_, i) => {
        const d = shiftDays(start, i);
        return { day: dayKey(d), date: d.getDate() };
      });
      const last = shiftDays(start, span - 1);
      return {
        cells: [...pad(start.getDay()), ...days],
        label: `${start.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })} – ${last.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}${span === MAX_CUSTOM_DAYS ? ` (first ${MAX_CUSTOM_DAYS} days)` : ""}`,
      };
    }

    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(year, month, i + 1);
      return { day: dayKey(d), date: i + 1 };
    });
    return {
      cells: [...pad(first.getDay()), ...days],
      label: first.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    };
  }, [scale, anchor, customStart, customEnd]);

  const step = (direction: 1 | -1) => {
    if (scale === "month") {
      onAnchorChange(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1));
    } else if (scale === "week") {
      onAnchorChange(shiftDays(anchor, 7 * direction));
    } else {
      onAnchorChange(shiftDays(anchor, direction));
    }
  };

  const today = new Date().toLocaleDateString("en-CA", { timeZone: orgTimezone });
  const chipLimit = CHIP_LIMIT[scale];

  return (
    <div className="rounded-xl border border-sand bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg border border-sand bg-parchment/40 p-1">
          {(["month", "week", "day", "custom"] as CalendarScale[]).map((option) => (
            <button
              key={option}
              onClick={() => {
                if (option === scale) return;
                setScale(option);
                // Changing scale re-centres on now. Landing on the week of
                // whatever month you happened to be browsing is never what
                // "week" meant.
                if (option !== "custom") onAnchorChange(new Date());
                else {
                  const today = new Date();
                  setCustomStart(dayKey(shiftDays(today, -6)));
                  setCustomEnd(dayKey(today));
                }
              }}
              className={`rounded-md px-2.5 py-1 text-[10px] font-semibold capitalize transition-colors ${
                scale === option
                  ? "bg-white text-espresso shadow-sm"
                  : "text-stone hover:text-espresso"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <p className="text-xs font-bold uppercase tracking-wide text-espresso">{label}</p>

        {scale === "custom" ? (
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="rounded-lg border border-sand bg-white px-2 py-1 text-[10px] text-espresso outline-none"
            />
            <span className="text-[10px] text-stone">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="rounded-lg border border-sand bg-white px-2 py-1 text-[10px] text-espresso outline-none"
            />
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={() => step(-1)}
              className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone hover:bg-stone/20"
            >
              ← Prev
            </button>
            <button
              onClick={() => onAnchorChange(new Date())}
              className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone hover:bg-stone/20"
            >
              Today
            </button>
            <button
              onClick={() => step(1)}
              className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone hover:bg-stone/20"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      <div className={scale === "day" ? "grid grid-cols-1" : "grid grid-cols-7 gap-1"}>
        {scale !== "day" &&
          ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div
              key={d}
              className="pb-1 text-center text-[10px] font-semibold uppercase text-walnut"
            >
              {d}
            </div>
          ))}

        {cells.map((cell, i) => {
          if (!cell) return <div key={`pad-${i}`} className={`${CELL_HEIGHT[scale]} rounded-lg`} />;
          const dayItems = byDay.get(cell.day) ?? [];
          // The calendar is a review queue first: work someone still has to look
          // at leads, and work the system approved on its own sits underneath.
          const forReview = dayItems.filter((item) => item.task?.review_required !== false);
          const auto = dayItems.filter((item) => item.task?.review_required === false);
          const expected = expectedByDay.get(cell.day) ?? [];
          const isToday = cell.day === today;
          const open = expandedDays.has(cell.day);
          const shownExpected = open ? expected : expected.slice(0, chipLimit);
          const shownForReview = open ? forReview : forReview.slice(0, chipLimit);
          const shownAuto = open ? auto : auto.slice(0, Math.max(1, Math.floor(chipLimit / 2)));
          const hidden =
            expected.length -
            shownExpected.length +
            (forReview.length - shownForReview.length) +
            (auto.length - shownAuto.length);

          // Week and day squares have the room, so they carry the client memo
          // under the task name — which is the line that actually says which
          // "SMC_Planning" this one is. Month stays one line per chip.
          const chipLabel = (item: FeedItem) => {
            const memo = item.task?.task_detail?.trim();
            const withMemo = (scale === "week" || scale === "day") && memo;
            // Account and person, short enough to sit in front of the name:
            // whose work it is and which client it's for, without a hover.
            const tag = [accountAbbr(item.task?.account), personInitials(item.profiles)]
              .filter(Boolean)
              .join(" ");
            return (
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {tag && <span className="mr-1 font-semibold opacity-60">{tag}</span>}
                  {item.task?.task_name ?? "Task"}
                </span>
                {withMemo && (
                  <span
                    className={`block text-[8px] leading-snug opacity-75 ${
                      scale === "day" ? "" : "truncate"
                    }`}
                  >
                    {memo}
                  </span>
                )}
              </span>
            );
          };

          const chip = (item: FeedItem, muted: boolean) => {
            const round = roundByItemId.get(item.id) ?? 0;
            const timeliness = timelinessOf(item, orgTimezone);
            return (
              <button
                key={item.id}
                onClick={() => item.task && onOpenTask(item.task.id)}
                title={`${item.task?.task_name ?? ""} — ${
                  item.profiles?.full_name || item.profiles?.username || ""
                }${round > 0 ? ` (revision ${round})` : ""} — ${TIMELINESS_LABEL[timeliness]}${
                  muted ? " — auto approved" : ""
                }`}
                className={`flex w-full items-start gap-1 rounded border px-1 py-[1px] text-left text-[9px] transition-opacity hover:opacity-80 ${
                  TIMELINESS_CHIP[timeliness]
                } ${muted ? "opacity-60" : ""}`}
              >
                {chipLabel(item)}
                <RevisionBadge
                  count={round}
                  late={timeliness !== "on_time" && timeliness !== "no_deadline"}
                />
              </button>
            );
          };

          return (
            <div
              key={cell.day}
              className={`${CELL_HEIGHT[scale]} rounded-lg border p-1 ${
                isToday ? "border-terracotta bg-cream/60" : "border-sand bg-white"
              }`}
            >
              <p className="mb-0.5 text-[10px] font-semibold text-stone">
                {scale === "day"
                  ? parseDayKey(cell.day).toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    })
                  : cell.date}
              </p>
              <div className="space-y-0.5">
                {shownExpected.length > 0 && (
                  <div className="space-y-0.5">
                    <p className="px-1 text-[8px] font-semibold uppercase tracking-wide text-stone">
                      Expected
                    </p>
                    {shownExpected.map((item) => {
                      const overdue = cell.day < today;
                      return (
                        <button
                          key={item.id}
                          onClick={() => item.task && onOpenTask(item.task.id)}
                          title={`${item.task?.task_name ?? ""} — ${
                            item.profiles?.full_name || item.profiles?.username || ""
                          } — ${overdue ? "due, nothing submitted" : "due"}`}
                          className={`flex w-full items-start gap-1 rounded border px-1 py-[1px] text-left text-[9px] transition-opacity hover:opacity-80 ${
                            overdue ? MISSED_CHIP : EXPECTED_CHIP
                          }`}
                        >
                          {chipLabel(item)}
                        </button>
                      );
                    })}
                  </div>
                )}

                {shownForReview.map((item) => chip(item, false))}

                {shownAuto.length > 0 && (
                  <div className="mt-1 space-y-0.5 border-t border-sand pt-1">
                    <p className="px-1 text-[8px] font-semibold uppercase tracking-wide text-stone">
                      Auto approved
                    </p>
                    {shownAuto.map((item) => chip(item, true))}
                  </div>
                )}

                {hidden > 0 && (
                  <button
                    onClick={() => toggleExpanded(cell.day)}
                    className="px-1 text-[9px] text-stone hover:text-espresso"
                  >
                    +{hidden} more
                  </button>
                )}
                {open && dayItems.length + expected.length > chipLimit && (
                  <button
                    onClick={() => toggleExpanded(cell.day)}
                    className="px-1 text-[9px] text-stone hover:text-espresso"
                  >
                    Show less
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
