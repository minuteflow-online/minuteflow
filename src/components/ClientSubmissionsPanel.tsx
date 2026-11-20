"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isUnreadCandidate } from "@/lib/submissionUnread";
import { showsInUnreadFilter } from "@/lib/unreadFilter";
import { localDay } from "@/lib/onTime";
import { allocateTaskTime, roundDays, type TaskTime } from "@/lib/submissionTime";
import type { ReportLog } from "@/lib/screenshotReport";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import RevisionBadge from "@/components/RevisionBadge";
import ClientThreadCard from "@/components/ClientThreadCard";
import ClientSubmissionsCalendar from "@/components/ClientSubmissionsCalendar";
import {
  formatDuration,
  formatDayKey,
  type ClientFeedItem,
  type ClientThread,
  type ClientDayCard,
  type ClientDayStats,
  type ClientPotentialTask,
  type ClientViewMode,
} from "@/lib/clientSubmissionsTypes";

const THREADS_PER_PAGE = 25;

const STATUS_OPTIONS = [
  { value: "awaiting", label: "Review" },
  { value: "revision_requested", label: "Revision" },
  { value: "approved", label: "Approved" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
];

const CATEGORY_OPTIONS = ["Task", "Communication", "Planning", "Collaboration"];

/** Items on a day the filters left visible include this day, by their own
 *  thread's first-worked-day — a note or a review sits with the submission it
 *  answers, same rule the real hub uses (see submissionThread.ts). */
function itemDays(item: ClientFeedItem, time: TaskTime | undefined, timezone: string): string[] {
  if (item.message_type !== "submission") return [localDay(item.created_at, timezone)];
  return roundDays(item, time?.bySubmission[item.id], timezone);
}

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
  const active = Boolean(from || to);
  const buttonLabel = !active ? label : from && to ? `${from} – ${to}` : from ? `From ${from}` : `To ${to}`;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] outline-none transition-colors ${
          active ? "border-terracotta/40 bg-terracotta-soft text-terracotta font-semibold" : "border-sand bg-white text-espresso"
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
            <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} className="w-full rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white" />
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-walnut">To</label>
            <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} className="w-full rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white" />
          </div>
          {active && (
            <button type="button" onClick={() => onChange("", "")} className="w-full rounded-lg text-[10px] font-semibold text-terracotta hover:underline">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function KeyLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-lg border border-sand bg-white px-2 py-1 text-[11px] font-semibold text-espresso"
      >
        Key
        <svg className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 12 12">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-30 flex w-[26rem] max-w-[80vw] flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-sand bg-white px-3 py-2 shadow-lg">
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
            <span className="text-[10px] font-bold px-1.5 py-[2px] rounded-full bg-amber text-white">NR</span>
            needs review
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-stone">
            <span className="text-[10px] font-bold px-1.5 py-[2px] rounded-full bg-slate-blue text-white">IP</span>
            in progress
          </span>
        </div>
      )}
    </div>
  );
}

type FeedResponse = {
  submissions: ClientFeedItem[];
  expected: ClientFeedItem[];
  taskSubmissions: Record<string, Array<{ id: number; created_at: string }>>;
  taskLogs: Record<string, Array<[string | null, number | null]>>;
  scLogs: Record<string, ReportLog>;
  potentialTasks: ClientPotentialTask[];
  potentialPeople: Record<string, string>;
  reviewState: Record<string, string>;
  flaggedTasks: Record<string, boolean>;
  unreadByTask: Record<string, number>;
};

export default function ClientSubmissionsPanel({ refreshKey }: { refreshKey: number }) {
  const supabase = useMemo(() => createClient(), []);
  const [currentUserId, setCurrentUserId] = useState("");
  const [orgTimezone, setOrgTimezone] = useState("UTC");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FeedResponse | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);

  const [view, setView] = useState<ClientViewMode>("timeline");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [vaFilter, setVaFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [taskDateFrom, setTaskDateFrom] = useState("");
  const [taskDateTo, setTaskDateTo] = useState("");
  const [submissionDateFrom, setSubmissionDateFrom] = useState("");
  const [submissionDateTo, setSubmissionDateTo] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [openedSinceUnreadOn, setOpenedSinceUnreadOn] = useState<Set<number>>(new Set());
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);
      const { data: org } = await supabase.from("organization_settings").select("timezone").limit(1).single();
      if (org?.timezone) setOrgTimezone(org.timezone);
    })();
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/client-admin/submissions", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    setPage(0);
  }, [vaFilter, statusFilter, categoryFilter, search, taskDateFrom, taskDateTo, submissionDateFrom, submissionDateTo, unreadOnly, flaggedOnly]);

  const items = useMemo<ClientFeedItem[]>(() => [...(data?.submissions ?? []), ...(data?.expected ?? [])], [data]);
  // Stable references for every piece of `data` used as a useMemo/useEffect
  // dependency below — `data?.x ?? {}` would otherwise hand out a fresh {}
  // literal every render, defeating the memoization it's supposed to key.
  const taskSubmissions = useMemo(() => data?.taskSubmissions ?? {}, [data]);
  const taskLogs = useMemo(() => data?.taskLogs ?? {}, [data]);
  const scLogs = useMemo(() => data?.scLogs ?? {}, [data]);
  const reviewState = useMemo(() => data?.reviewState ?? {}, [data]);
  const unreadByTask = useMemo(() => data?.unreadByTask ?? {}, [data]);
  const flaggedTasks = useMemo(() => data?.flaggedTasks ?? {}, [data]);
  const potentialTasks = useMemo(() => data?.potentialTasks ?? [], [data]);

  const vaOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items) {
      if (item.user_id && item.profiles) seen.set(item.user_id, item.profiles.full_name || item.profiles.username || "Unknown");
    }
    return Array.from(seen, ([value, label]) => ({ value, label }));
  }, [items]);

  /** Applies a filter that describes submitted work by deciding which THREADS
   *  qualify, then keeping every row on a qualifying thread — a reviewer's own
   *  note must never silently vanish because its own fields (who wrote it,
   *  when) don't match a VA- or date-based filter. See submissions page's own
   *  keepQualifyingThreads for the full story (2026-09-14 incident). */
  const keepQualifyingThreads = useCallback((rows: ClientFeedItem[], predicate: (row: ClientFeedItem) => boolean) => {
    const qualifyingTaskIds = new Set(
      rows.filter((r) => r.message_type === "submission" && predicate(r)).map((r) => r.task?.id ?? r.assigned_task_id).filter((id): id is number => id != null)
    );
    return rows.filter((r) => {
      if (r.message_type === "expected") return predicate(r);
      const taskId = r.task?.id ?? r.assigned_task_id;
      return taskId != null && qualifyingTaskIds.has(taskId);
    });
  }, []);

  const visibleItems = useMemo(() => {
    let rows = items;

    if (vaFilter.size > 0) rows = keepQualifyingThreads(rows, (r) => Boolean(r.user_id && vaFilter.has(r.user_id)));

    const term = search.trim().toLowerCase();
    if (term) {
      rows = rows.filter((r) =>
        [r.task?.task_name, r.task?.task_detail, r.task?.account, r.submission_comment, r.submission_link, r.content, r.profiles?.full_name, r.profiles?.username]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(term))
      );
    }

    if (statusFilter.size > 0) {
      rows = rows.filter((r) => {
        if (!r.task) return false;
        if (r.progress_status === "in_progress") return statusFilter.has("in_progress");
        const state = reviewState[String(r.task.id)] ?? "awaiting";
        return statusFilter.has(state);
      });
    }

    if (categoryFilter.size > 0) rows = rows.filter((r) => categoryFilter.has((r.task?.category ?? "").trim()));

    if (taskDateFrom || taskDateTo) {
      rows = rows.filter((r) => {
        const d = r.task?.due_date;
        if (!d) return false;
        if (taskDateFrom && d < taskDateFrom) return false;
        if (taskDateTo && d > taskDateTo) return false;
        return true;
      });
    }

    if (submissionDateFrom || submissionDateTo) {
      rows = keepQualifyingThreads(rows, (r) => {
        const d = localDay(r.created_at, orgTimezone);
        if (submissionDateFrom && d < submissionDateFrom) return false;
        if (submissionDateTo && d > submissionDateTo) return false;
        return true;
      });
    }

    if (unreadOnly) rows = rows.filter((r) => showsInUnreadFilter(r.task?.id ?? r.assigned_task_id, unreadByTask, openedSinceUnreadOn));

    if (flaggedOnly) {
      rows = rows.filter((r) => {
        const taskId = r.task?.id ?? r.assigned_task_id;
        return taskId != null && flaggedTasks[taskId] === true;
      });
    }

    return rows;
  }, [items, vaFilter, keepQualifyingThreads, search, statusFilter, reviewState, categoryFilter, taskDateFrom, taskDateTo, submissionDateFrom, submissionDateTo, orgTimezone, unreadOnly, unreadByTask, openedSinceUnreadOn, flaggedOnly, flaggedTasks]);

  const allThreads = useMemo(() => {
    const byTask = new Map<number, ClientFeedItem[]>();
    for (const item of visibleItems) {
      if (item.message_type === "expected") continue;
      const key = item.task?.id ?? item.assigned_task_id ?? -item.id;
      const list = byTask.get(key) ?? [];
      list.push(item);
      byTask.set(key, list);
    }
    const threads: ClientThread[] = Array.from(byTask.entries()).map(([taskId, list]) => {
      const ordered = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const submissionsOnly = ordered.filter((i) => i.message_type === "submission");
      const latest = submissionsOnly[submissionsOnly.length - 1] ?? ordered[ordered.length - 1];
      return { taskId, items: ordered, latest };
    });
    threads.sort((a, b) => b.latest.created_at.localeCompare(a.latest.created_at));
    return threads;
  }, [visibleItems]);

  const taskTimes = useMemo(() => {
    const map = new Map<number, TaskTime>();
    for (const [taskId, subs] of Object.entries(taskSubmissions)) {
      const logs = (taskLogs[taskId] ?? []).map(([start_time, duration_ms]) => ({ start_time, duration_ms }));
      map.set(Number(taskId), allocateTaskTime(subs, logs, orgTimezone));
    }
    return map;
  }, [taskSubmissions, taskLogs, orgTimezone]);

  const allCards = useMemo(() => {
    const cards: ClientDayCard[] = [];
    for (const thread of allThreads) {
      const time = taskTimes.get(thread.taskId);
      const days = new Set<string>();
      for (const item of thread.items) {
        if (item.message_type !== "submission") continue;
        for (const d of itemDays(item, time, orgTimezone)) days.add(d);
      }
      if (days.size === 0) days.add(localDay(thread.latest.created_at, orgTimezone));
      for (const day of days) cards.push({ key: `${day}-${thread.taskId}`, day, thread });
    }
    cards.sort((a, b) => b.day.localeCompare(a.day) || b.thread.latest.created_at.localeCompare(a.thread.latest.created_at));
    return cards;
  }, [allThreads, taskTimes, orgTimezone]);

  const pageCount = Math.max(1, Math.ceil(allCards.length / THREADS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);

  const threadsByDay = useMemo(() => {
    const start = safePage * THREADS_PER_PAGE;
    const map = new Map<string, ClientDayCard[]>();
    for (const card of allCards.slice(start, start + THREADS_PER_PAGE)) {
      const list = map.get(card.day) ?? [];
      list.push(card);
      map.set(card.day, list);
    }
    return map;
  }, [allCards, safePage]);

  const dayStats = useMemo(() => {
    type Line = { submittedMs: number; potentialMs: number };
    const acc = new Map<string, { submissionCount: number; needs: Set<number>; lines: Map<string, Line> }>();
    const at = (day: string) => {
      let d = acc.get(day);
      if (!d) {
        d = { submissionCount: 0, needs: new Set(), lines: new Map() };
        acc.set(day, d);
      }
      return d;
    };
    const line = (day: string, key: string) => {
      const d = at(day);
      let l = d.lines.get(key);
      if (!l) {
        l = { submittedMs: 0, potentialMs: 0 };
        d.lines.set(key, l);
      }
      return l;
    };

    for (const card of allCards) {
      const d = at(card.day);
      const time = taskTimes.get(card.thread.taskId);
      d.submissionCount += card.thread.items.filter((i) => i.message_type === "submission" && itemDays(i, time, orgTimezone).includes(card.day)).length;
      const state = reviewState[String(card.thread.taskId)];
      if (state === undefined || state === "awaiting") d.needs.add(card.thread.taskId);
    }
    const days = new Set(acc.keys());

    for (const thread of allThreads) {
      const time = taskTimes.get(thread.taskId);
      if (!time) continue;
      const key = `t${thread.taskId}`;
      for (const round of Object.values(time.bySubmission)) {
        for (const [day, ms] of Object.entries(round.byDay)) {
          if (!days.has(day) || ms <= 0) continue;
          const l = line(day, key);
          l.submittedMs += ms;
          l.potentialMs += ms;
        }
      }
      for (const [day, ms] of Object.entries(time.unsubmittedByDay)) {
        if (!days.has(day) || ms <= 0) continue;
        line(day, key).potentialMs += ms;
      }
    }

    const term = search.trim().toLowerCase();
    for (const pt of potentialTasks) {
      if (term && ![pt.task.task_name, pt.task.task_detail, pt.task.account].some((f) => f && f.toLowerCase().includes(term))) continue;
      if (categoryFilter.size > 0 && !categoryFilter.has((pt.task.category ?? "").trim())) continue;
      if (statusFilter.size > 0 && !statusFilter.has("in_progress")) continue;
      if (taskDateFrom || taskDateTo) {
        if (!pt.task.due_date) continue;
        if (taskDateFrom && pt.task.due_date < taskDateFrom) continue;
        if (taskDateTo && pt.task.due_date > taskDateTo) continue;
      }
      if (submissionDateFrom || submissionDateTo || unreadOnly || flaggedOnly) continue;
      for (const [uid, start, dur] of pt.logs) {
        if (vaFilter.size > 0 && !vaFilter.has(uid)) continue;
        const startMs = Date.parse(start);
        const endMs = startMs + dur;
        let cursor = startMs;
        while (cursor < endMs) {
          const day = localDay(new Date(cursor).toISOString(), orgTimezone);
          if (days.has(day)) line(day, `p${pt.task.id}-${uid}`).potentialMs += Math.min(dur, endMs - cursor);
          cursor = endMs;
        }
      }
    }

    const out = new Map<string, ClientDayStats>();
    for (const [day, d] of acc) {
      const lines = Array.from(d.lines.values());
      out.set(day, {
        submissionCount: d.submissionCount,
        needsReview: d.needs.size,
        submittedMs: lines.reduce((n, l) => n + l.submittedMs, 0),
        potentialMs: lines.reduce((n, l) => n + l.potentialMs, 0),
        breakdown: "",
      });
    }
    return out;
  }, [allCards, allThreads, taskTimes, reviewState, orgTimezone, potentialTasks, search, categoryFilter, statusFilter, taskDateFrom, taskDateTo, submissionDateFrom, submissionDateTo, unreadOnly, flaggedOnly, vaFilter]);

  const submissionCount = useMemo(() => visibleItems.filter((i) => i.message_type === "submission").length, [visibleItems]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, ClientFeedItem[]>();
    for (const item of visibleItems) {
      if (item.message_type !== "submission") continue;
      const day = localDay(item.created_at, orgTimezone);
      const list = map.get(day) ?? [];
      list.push(item);
      map.set(day, list);
    }
    return map;
  }, [visibleItems, orgTimezone]);

  const expectedByDay = useMemo(() => {
    const map = new Map<string, ClientFeedItem[]>();
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

  const roundByItemId = useMemo(() => {
    const byTask = new Map<number, ClientFeedItem[]>();
    for (const item of visibleItems) {
      if (item.message_type !== "submission") continue;
      const key = item.task?.id ?? item.assigned_task_id ?? -item.id;
      byTask.set(key, (byTask.get(key) ?? []).concat(item));
    }
    const map = new Map<number, number>();
    for (const list of byTask.values()) {
      [...list].sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach((item, index) => map.set(item.id, index));
    }
    return map;
  }, [visibleItems]);

  const onReview = useCallback(
    async (taskId: number, action: "approve" | "revision", note?: string) => {
      setBusyTaskId(taskId);
      try {
        await fetch("/api/client-admin/submissions/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, action, note }),
        });
        await load();
      } finally {
        setBusyTaskId(null);
      }
    },
    [load]
  );

  const onMarkRead = useCallback(
    (taskId: number) => {
      if (!currentUserId || (unreadByTask[taskId] ?? 0) === 0) return;
      setOpenedSinceUnreadOn((prev) => new Set(prev).add(taskId));
      const seen = items
        .filter((i) => (i.task?.id ?? i.assigned_task_id) === taskId && isUnreadCandidate(i, currentUserId))
        .map((i) => ({ user_id: currentUserId, submission_id: i.id }));
      if (seen.length > 0) {
        void supabase.from("submission_reads").upsert(seen, { onConflict: "user_id,submission_id", ignoreDuplicates: true });
      }
    },
    [supabase, currentUserId, unreadByTask, items]
  );

  // Clicking a Calendar chip takes the reader to Timeline — not a deep
  // scroll-to-card (no notification-style ?taskId= link exists for the
  // client view), just the right view to find the thread in.
  const onOpenTask = useCallback(() => {
    setView("timeline");
  }, []);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Work Submitted</h3>
        <div className="inline-flex items-center gap-1 rounded-lg border border-sand bg-parchment/40 p-1">
          {(["timeline", "calendar"] as ClientViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-semibold capitalize transition-colors ${view === v ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sand bg-white px-3 py-2">
        <KeyLegend />

        <button
          type="button"
          onClick={() => {
            setOpenedSinceUnreadOn(new Set());
            setUnreadOnly((v) => !v);
          }}
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${unreadOnly ? "border-terracotta/30 bg-terracotta-soft text-terracotta" : "border-sand bg-white text-stone hover:border-walnut"}`}
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m2 6 10 7 10-7" />
          </svg>
          Unread
          {Object.keys(unreadByTask).length > 0 && <span className="rounded-full bg-terracotta px-1.5 py-[1px] text-[10px] font-bold text-white">{Object.keys(unreadByTask).length}</span>}
        </button>

        <button
          type="button"
          onClick={() => setFlaggedOnly((v) => !v)}
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${flaggedOnly ? "border-terracotta/30 bg-terracotta-soft text-terracotta" : "border-sand bg-white text-stone hover:border-walnut"}`}
          title="Show only flagged tasks"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 21V4m0 0h11l-2 4 2 4H5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Flagged
          {Object.keys(flaggedTasks).length > 0 && <span className="rounded-full bg-terracotta px-1.5 py-[1px] text-[10px] font-bold text-white">{Object.keys(flaggedTasks).length}</span>}
        </button>

        <DateRangeChip label="Task date" from={taskDateFrom} to={taskDateTo} onChange={(f, t) => { setTaskDateFrom(f); setTaskDateTo(t); }} />
        <DateRangeChip label="Submission date" from={submissionDateFrom} to={submissionDateTo} onChange={(f, t) => { setSubmissionDateFrom(f); setSubmissionDateTo(t); }} />

        <MultiSelectFilter allLabel="All VAs" selected={vaFilter} onChange={setVaFilter} options={vaOptions} />
        <MultiSelectFilter allLabel="All statuses" selected={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
        <MultiSelectFilter allLabel="All categories" selected={categoryFilter} onChange={setCategoryFilter} options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: c }))} />

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search submissions..."
          className="ml-auto w-64 rounded-lg border border-sand bg-white px-2 py-1 text-[11px] text-espresso outline-none placeholder:text-stone/60"
        />
        <span className="text-[11px] text-stone">{loading ? "Loading..." : `${submissionCount} submission${submissionCount === 1 ? "" : "s"}`}</span>
      </div>

      {view === "calendar" ? (
        <ClientSubmissionsCalendar
          byDay={itemsByDay}
          expectedByDay={expectedByDay}
          anchor={monthAnchor}
          onAnchorChange={setMonthAnchor}
          orgTimezone={orgTimezone}
          roundByItemId={roundByItemId}
          onOpenTask={onOpenTask}
        />
      ) : allCards.length === 0 ? (
        <div className="rounded-xl border border-sand bg-white p-4">
          <p className="text-sm font-medium text-espresso">No submissions yet</p>
          <p className="mt-1 text-xs text-stone">Assign a task above to start seeing your VAs&apos; work here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(threadsByDay.entries()).map(([day, cards]) => {
            const stats = dayStats.get(day);
            return (
              <div key={day}>
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-stone">
                  <span className="font-bold uppercase tracking-wide text-walnut">{formatDayKey(day)}</span>
                  {stats && (
                    <>
                      <span>{stats.submissionCount} submission{stats.submissionCount === 1 ? "" : "s"}</span>
                      <span>Potential {formatDuration(stats.potentialMs)}</span>
                      <span>Submitted {formatDuration(stats.submittedMs)}</span>
                      {stats.needsReview > 0 && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-[2px] text-[10px] font-semibold text-amber-600">
                          {stats.needsReview} need review
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="space-y-2">
                  {cards.map((card) => (
                    <ClientThreadCard
                      key={card.key}
                      thread={card.thread}
                      viewDay={card.day}
                      taskTime={taskTimes.get(card.thread.taskId)}
                      scLogs={scLogs}
                      state={reviewState[String(card.thread.taskId)]}
                      timezone={orgTimezone}
                      unreadCount={unreadByTask[card.thread.taskId] ?? 0}
                      busy={busyTaskId === card.thread.taskId}
                      onReview={onReview}
                      onMarkRead={onMarkRead}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {pageCount > 1 && (
            <div className="flex items-center justify-between text-[11px] text-stone">
              <span>Page {safePage + 1} of {pageCount}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0} className="rounded-lg bg-stone/10 px-3 py-1 font-semibold text-stone hover:bg-stone/20 disabled:opacity-40">← Newer</button>
                <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1} className="rounded-lg bg-stone/10 px-3 py-1 font-semibold text-stone hover:bg-stone/20 disabled:opacity-40">Older →</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
