"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setAssignedTaskStatus } from "@/lib/assignedTaskStatus";
import {
  SUBMISSION_TYPE_BADGE,
  SUBMISSION_TYPE_LABELS,
  type SubmissionMessageType,
  type SubmissionScopeFilter,
  type TaskSubmissionAttachment,
} from "@/lib/submissions";
import RevisionBadge from "@/components/RevisionBadge";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import type { AssignedTaskStatus, Project } from "@/types/database";
import { CATEGORY_OPTIONS } from "@/lib/taskSchedule";

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
  attachments: TaskSubmissionAttachment[];
  profiles?: { id: string; full_name: string | null; username: string | null } | null;
  task: {
    id: number;
    task_name: string;
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
    due_date: string | null;
    due_time: string | null;
    end_date: string | null;
    end_time: string | null;
  } | null;
};

/** Every submission for one task, oldest first — the original plus its resubmissions. */
type Thread = { taskId: number; items: FeedItem[]; latest: FeedItem };

type TeamMember = { id: string; full_name: string; username: string };

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
function isLate(item: FeedItem, timezone: string): boolean | null {
  const deadline = deadlineFor(item.task, timezone);
  if (!deadline) return null;
  const submitted = `${localDay(item.created_at, timezone)} ${new Date(item.created_at).toLocaleTimeString("en-GB", { hour12: false, timeZone: timezone })}`;
  return submitted > deadline;
}

function scopeLabel(item: FeedItem) {
  if (!item.task?.project_id) return "Adhoc";
  if (item.task.project_kind === "objective") return "Objective";
  if (item.task.project_kind === "operation") return "Operations";
  return "Project";
}

export default function SubmissionsPage() {
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
  const [assignedByFilter, setAssignedByFilter] = useState<Set<string>>(new Set());
  // Every filter is multi-select; an empty set means "all".
  const [vaFilter, setVaFilter] = useState<Set<string>>(new Set());
  const [scopeFilter, setScopeFilter] = useState<Set<string>>(new Set());
  const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());
  // Defaults to Task: Communication/Planning/Collaboration work auto-completes
  // on submit and isn't something anyone reviews, so it stays out of the way
  // until deliberately asked for.
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set(["Task"]));
  const [accountFilter, setAccountFilter] = useState<Set<string>>(new Set());
  const [clientFilter, setClientFilter] = useState<Set<string>>(new Set());

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  // client id -> the account names billed to that client, since a task points
  // at an account by name and only the mapping table knows the client.
  const [accountsByClient, setAccountsByClient] = useState<Map<string, Set<string>>>(new Map());
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [busyId, setBusyId] = useState<number | null>(null);

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
        setClients(d.clients ?? []);
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
      setItems(data.submissions ?? []);
      setRoundDurations(data.roundDurations ?? {});
      setReviewState(data.reviewState ?? {});
      setCanReview(Boolean(data.canReview));
      setCanEmptyTrash(Boolean(data.canEmptyTrash));
      setSeesAll(Boolean(data.seesAll));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [showTrash]);

  useEffect(() => {
    void load();
  }, [load]);

  // Approve / Request revision append a row to the same thread, then move the
  // task's status through the app's single status path.
  const review = useCallback(
    async (item: FeedItem, outcome: ReviewOutcome, note?: string) => {
      if (!item.task) return;
      setBusyId(item.id);
      try {
        const res = await fetch(`/api/assigned-tasks/${item.task.id}/submissions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message_type: outcome,
            message: note?.trim() || REVIEW_DEFAULT_NOTE[outcome],
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

  /** Trashes or restores every submission on one task, from the card header. */
  const trashThread = useCallback(
    async (thread: Thread, restore: boolean) => {
      const count = thread.items.length;
      if (
        !restore &&
        !confirm(
          `Move ${count} submission${count === 1 ? "" : "s"} on this task to trash?

They can be restored from the Trash view.`
        )
      ) {
        return;
      }
      setBusyId(thread.latest.id);
      try {
        for (const item of thread.items) {
          if (!item.task) continue;
          await fetch(
            `/api/assigned-tasks/${item.task.id}/submissions?submissionId=${item.id}${restore ? "&restore=1" : ""}`,
            { method: "DELETE" }
          );
        }
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

  /** Appends a note to a task's thread. Never edits — that's the whole point. */
  const addNote = useCallback(
    async (item: FeedItem, note: string) => {
      if (!item.task) return;
      setBusyId(item.id);
      try {
        const res = await fetch(`/api/assigned-tasks/${item.task.id}/submissions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_type: "comment", message: note }),
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

    if (vaFilter.size > 0) {
      rows = rows.filter((r) => vaFilter.has(r.user_id));
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
      rows = rows.filter((r) => r.user_id === currentUserId);
    } else if (ownerMode === "to_me") {
      rows = rows.filter((r) => r.task?.assigned_by === currentUserId);
    }

    if (assignedByFilter.size > 0) {
      rows = rows.filter((r) => r.task?.assigned_by && assignedByFilter.has(r.task.assigned_by));
    }

    if (categoryFilter.size > 0) {
      rows = rows.filter((r) => categoryFilter.has((r.task?.category ?? "").trim()));
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

    return rows;
  }, [items, vaFilter, scopeFilter, projectFilter, categoryFilter, accountFilter, clientFilter, accountsByClient, ownerMode, currentUserId, assignedByFilter]);

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

  // Which revision round each submission belongs to — its position in its
  // task's thread. The calendar shows loose submissions rather than threads, so
  // each chip needs to carry its own round marker.
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
  const threadsByDay = useMemo(() => {
    const byTask = new Map<number, FeedItem[]>();
    for (const item of visibleItems) {
      const key = item.task?.id ?? item.assigned_task_id ?? -item.id;
      const list = byTask.get(key) ?? [];
      list.push(item);
      byTask.set(key, list);
    }

    const threads: Thread[] = Array.from(byTask.entries()).map(([taskId, list]) => {
      const ordered = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
      return { taskId, items: ordered, latest: ordered[ordered.length - 1] };
    });

    // A thread sits on the day of its most recent submission, so reworked
    // tasks resurface as current activity instead of staying buried on the
    // date they were first submitted.
    const map = new Map<string, Thread[]>();
    for (const thread of threads) {
      const day = localDay(thread.latest.created_at, orgTimezone);
      const list = map.get(day) ?? [];
      list.push(thread);
      map.set(day, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.latest.created_at.localeCompare(a.latest.created_at));
    }
    return map;
  }, [visibleItems, orgTimezone]);

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

        <span className="ml-auto text-[11px] text-stone">
          {loading ? "Loading..." : `${submissionCount} submission${submissionCount === 1 ? "" : "s"}`}
        </span>
      </div>

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
          onTrash={trashSubmission}
          onTrashThread={trashThread}
        />
      ) : (
        <CalendarView
          byDay={itemsByDay}
          anchor={monthAnchor}
          onAnchorChange={setMonthAnchor}
          orgTimezone={orgTimezone}
          roundByItemId={roundByItemId}
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
  // Auto-approved work is deliberately excluded: nobody is expected to act on
  // it, so counting it would overstate the queue.
  const needsReview = threads.filter((t) => {
    const state = reviewState[String(t.taskId)];
    if (state === "revision_requested" || state === "approved") return false;
    return t.latest.task?.review_required !== false;
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

/** One entry inside a thread — the original submission, or a resubmission. */
function SubmissionEntry({
  item,
  index,
  roundMs,
  timezone,
  canTrash,
  trashed,
  onTrash,
}: {
  item: FeedItem;
  index: number;
  /** Time logged during this revision round, if any was tracked. */
  roundMs?: number;
  timezone: string;
  /** Admin and above; everyone else can't trash a record they may have written. */
  canTrash: boolean;
  trashed: boolean;
  onTrash: (item: FeedItem, restore: boolean) => void;
}) {
  const who = item.profiles?.full_name || item.profiles?.username || "Unknown";
  const time = new Date(item.created_at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  // Reviews and notes are events between rounds, not work turned in — they read
  // as a single line so the submissions stay the backbone of the thread.
  if (item.message_type !== "submission") {
    const type = item.message_type as SubmissionMessageType;
    return (
      <div className="flex items-start gap-1.5 pt-1.5">
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
      </div>
    );
  }

  const isResubmission = index > 0;
  const late = isLate(item, timezone);

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
        {canTrash && (
          <button
            onClick={() => onTrash(item, Boolean(trashed))}
            className="text-[10px] font-semibold text-stone transition-colors hover:text-terracotta"
            title={trashed ? "Restore this submission" : "Move to trash — nothing is destroyed"}
          >
            {trashed ? "Restore" : "Trash"}
          </button>
        )}
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

      {item.submission_comment && (
        <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-snug text-espresso">
          {item.submission_comment}
        </p>
      )}

      {item.submission_link && (
        <a
          href={item.submission_link}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block truncate text-[12px] text-terracotta hover:underline"
        >
          {item.submission_link}
        </a>
      )}

      {item.attachments.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {item.attachments.map((file) => (
            <a
              key={file.id}
              href={file.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-sand bg-cream/40 px-2 py-1 text-[11px] text-terracotta hover:bg-cream"
            >
              {file.filename}
            </a>
          ))}
        </div>
      )}
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
  onTrash,
  onTrashThread,
}: {
  thread: Thread;
  canReview: boolean;
  busy: boolean;
  onReview: (item: FeedItem, outcome: ReviewOutcome, note?: string) => void;
  onAddNote: (item: FeedItem, note: string) => void;
  /** round index -> ms logged during that round. */
  rounds: Record<string, number>;
  /** "awaiting" | "revision_requested" | "approved" */
  state?: string;
  timezone: string;
  trashed: boolean;
  onTrash: (item: FeedItem, restore: boolean) => void;
  onTrashThread: (thread: Thread, restore: boolean) => void;
}) {
  // Notes and reviews live in the thread too, but the submissions are what the
  // numbering, the rounds and the review actions all key off.
  const submissions = thread.items.filter((i) => i.message_type === "submission");
  const head = submissions[0] ?? thread.items[0];
  const latest = submissions[submissions.length - 1] ?? thread.latest;
  const resubmissions = Math.max(0, submissions.length - 1);
  const submissionIndex = new Map(submissions.map((s, i) => [s.id, i]));

  const [expanded, setExpanded] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteMode, setNoteMode] = useState<null | "revision" | "note">(null);

  // Whole-task effort: every round summed. Grows with each resubmission, while
  // each entry below keeps its own round's figure.
  const totalMs = Object.values(rounds).reduce((sum, ms) => sum + ms, 0);

  // Unknown state falls through to "awaiting" — better to offer the buttons
  // than to hide a decision that still needs making.
  const awaitingReview = state !== "revision_requested" && state !== "approved";
  // An approval on a task that never required review is labelled as such, so
  // "Approved" always means a person actually looked at it.
  const autoApproved = state === "approved" && latest.task?.review_required === false;
  const pill = autoApproved
    ? REVIEW_STATE_PILL.auto_approved
    : state
      ? REVIEW_STATE_PILL[state]
      : undefined;

  return (
    <div className="rounded-lg border border-sand bg-white px-3 py-2.5">
      {/* Task Name | R# Task Type | Total time | Approve Revise */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
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
            {head.task?.task_name ?? "Task removed"}
          </span>
          <RevisionBadge count={resubmissions} />
          <span className="shrink-0 rounded-full border border-stone/20 bg-stone/10 px-2 py-[2px] text-[10px] font-semibold text-stone">
            {scopeLabel(head)}
          </span>
        </button>

        {canReview && (
          <button
            onClick={() => onTrashThread(thread, trashed)}
            disabled={busy}
            className="shrink-0 text-[10px] font-semibold text-stone transition-colors hover:text-terracotta disabled:opacity-50"
            title={
              trashed
                ? "Restore every submission on this task"
                : "Move this task's submissions to trash"
            }
          >
            {trashed ? "Restore" : "Trash"}
          </button>
        )}

        {totalMs > 0 && (
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
            <button
              onClick={() => onReview(latest, "approval")}
              disabled={busy}
              className="rounded-lg bg-sage px-2.5 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={() => {
                setNoteMode("revision");
                setExpanded(true);
              }}
              disabled={busy}
              className="rounded-lg bg-stone/10 px-2.5 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50"
            >
              Revise
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
      </div>

      <div className="mt-0.5 pl-[18px] text-[11px] text-stone/80">
        {head.task?.account ?? "—"}
        {head.task?.project_name ? ` · ${head.task.project_name}` : ""}
        {head.task?.assigned_by_name ? ` · reviewer: ${head.task.assigned_by_name}` : ""}
        {!expanded &&
          ` · ${thread.items.length} submission${thread.items.length === 1 ? "" : "s"}`}
      </div>

      {expanded && (
        <div className="mt-1 space-y-1">
          {thread.items.map((item) => {
            const idx = submissionIndex.get(item.id) ?? 0;
            return (
              <SubmissionEntry
                key={item.id}
                item={item}
                index={idx}
                roundMs={item.message_type === "submission" ? rounds[String(idx)] : undefined}
                timezone={timezone}
                canTrash={canReview}
                trashed={trashed}
                onTrash={onTrash}
              />
            );
          })}

          {noteMode ? (
            <div className="mt-2 rounded-lg border border-sand bg-cream/40 p-2">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-walnut">
                {noteMode === "revision" ? "What needs changing?" : "Add a note"}
              </label>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={2}
                autoFocus
                placeholder={
                  noteMode === "revision"
                    ? "Tell them what to fix..."
                    : "Anything to add — this is appended, nothing is overwritten"
                }
                className="w-full resize-none rounded-lg border border-sand bg-white px-2 py-1.5 text-xs text-espresso outline-none"
              />
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  onClick={() => {
                    const note = noteDraft.trim();
                    if (!note) return;
                    if (noteMode === "revision") onReview(latest, "revision", note);
                    else onAddNote(latest, note);
                    setNoteDraft("");
                    setNoteMode(null);
                  }}
                  disabled={busy || !noteDraft.trim()}
                  className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
                >
                  {noteMode === "revision" ? "Request Revision" : "Add Note"}
                </button>
                <button
                  onClick={() => {
                    setNoteMode(null);
                    setNoteDraft("");
                  }}
                  disabled={busy}
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
  onTrash,
  onTrashThread,
}: {
  byDay: Map<string, Thread[]>;
  orgTimezone: string;
  canReview: boolean;
  busyId: number | null;
  onReview: (item: FeedItem, outcome: ReviewOutcome, note?: string) => void;
  onAddNote: (item: FeedItem, note: string) => void;
  loading: boolean;
  roundDurations: Record<string, Record<string, number>>;
  reviewState: Record<string, string>;
  showTrash: boolean;
  onTrash: (item: FeedItem, restore: boolean) => void;
  onTrashThread: (thread: Thread, restore: boolean) => void;
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
                onTrash={onTrash}
                onTrashThread={onTrashThread}
              />
            ))}
        </DayGroup>
      ))}
    </div>
  );
}

function CalendarView({
  byDay,
  anchor,
  onAnchorChange,
  orgTimezone,
  roundByItemId,
}: {
  byDay: Map<string, FeedItem[]>;
  anchor: Date;
  onAnchorChange: (d: Date) => void;
  orgTimezone: string;
  roundByItemId: Map<number, number>;
}) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = first.getDay();

  const cells: Array<{ day: string; date: number } | null> = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const day = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day, date: d });
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: orgTimezone });

  return (
    <div className="rounded-xl border border-sand bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => onAnchorChange(new Date(year, month - 1, 1))}
          className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone hover:bg-stone/20"
        >
          ← Prev
        </button>
        <p className="text-xs font-bold uppercase tracking-wide text-espresso">
          {first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </p>
        <button
          onClick={() => onAnchorChange(new Date(year, month + 1, 1))}
          className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone hover:bg-stone/20"
        >
          Next →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="pb-1 text-center text-[10px] font-semibold uppercase text-walnut">
            {d}
          </div>
        ))}

        {cells.map((cell, i) => {
          if (!cell) return <div key={`pad-${i}`} className="min-h-[76px] rounded-lg" />;
          const dayItems = byDay.get(cell.day) ?? [];
          const isToday = cell.day === today;

          return (
            <div
              key={cell.day}
              className={`min-h-[76px] rounded-lg border p-1 ${
                isToday ? "border-terracotta bg-cream/60" : "border-sand bg-white"
              }`}
            >
              <p className="mb-0.5 text-[10px] font-semibold text-stone">{cell.date}</p>
              <div className="space-y-0.5">
                {dayItems.slice(0, 3).map((item) => {
                  const round = roundByItemId.get(item.id) ?? 0;
                  const wasLate = isLate(item, orgTimezone) === true;
                  return (
                    <div
                      key={item.id}
                      title={`${item.task?.task_name ?? ""} — ${
                        item.profiles?.full_name || item.profiles?.username || ""
                      }${round > 0 ? ` (revision ${round})` : ""}${wasLate ? " — late" : ""}`}
                      className={`flex items-center gap-1 rounded border px-1 py-[1px] text-[9px] ${
                        round > 0
                          ? "border-amber-200 bg-amber-50 text-amber-600"
                          : "border-sky-200 bg-sky-50 text-sky-600"
                      }`}
                    >
                      <span className="truncate">{item.task?.task_name ?? "Task"}</span>
                      <RevisionBadge count={round} late={wasLate} />
                    </div>
                  );
                })}
                {dayItems.length > 3 && (
                  <p className="px-1 text-[9px] text-stone">+{dayItems.length - 3} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
