"use client";

// View-only Calendar for the Dashboard — the signed-in user's own assigned
// tasks laid out by due date, one week at a time, switchable between a
// day-by-day board and a flat chronological list. Toni's call, 2026-11-10:
// a separate thing from DashboardBoardView just above it, which groups by
// status, not date, and is editable.
//
// Read-only on purpose: no drag, no inline edit, no status change. It's a
// "what's coming up, and when" view, not a second place to manage tasks.

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDaysToDateStr, getDateInTimezone } from "@/lib/taskSchedule";

// Same classes as DashboardBoardView / VAProjectsTab's STATUS_CLASSES /
// AGENTS.md's documented assigned_tasks status badge palette — not re-derived.
const STATUS_CLASSES: Record<string, string> = {
  on_queue: "bg-stone/10 text-stone border-stone/20",
  pending: "bg-stone/10 text-stone border-stone/20",
  unassigned: "bg-stone/10 text-stone border-stone/20",
  in_progress: "bg-amber-50 text-amber-500 border-amber-200",
  submitted: "bg-sky-50 text-sky-600 border-sky-200",
  reviewing: "bg-violet-50 text-violet-600 border-violet-200",
  revision_needed: "bg-amber-50 text-amber-600 border-amber-200",
  approved: "bg-emerald-50 text-emerald-600 border-emerald-200",
  completed: "bg-sage-soft text-sage border-sage/20",
  paid: "bg-purple-50 text-purple-600 border-purple-200",
  cancelled: "bg-red-50 text-red-500 border-red-200",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_CLASSES[status] ?? "bg-stone/10 text-stone border-stone/20";
  return (
    <span className={`shrink-0 text-[9px] font-semibold px-1.5 py-[1px] rounded-full border ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Sunday of the week dateStr falls in — same convention the Productivity Calendar uses. */
function weekStartFor(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return addDaysToDateStr(dateStr, -d.getUTCDay());
}

function formatDayHeader(dateStr: string): { weekday: string; day: number } {
  const d = new Date(dateStr + "T12:00:00Z");
  return { weekday: WEEKDAY_LABELS[d.getUTCDay()], day: Number(dateStr.slice(8, 10)) };
}

function formatRangeLabel(weekStart: string): string {
  const end = addDaysToDateStr(weekStart, 6);
  const start = new Date(weekStart + "T12:00:00Z");
  const endD = new Date(end + "T12:00:00Z");
  // Always carries month + day + year on both ends — a day/year pair with no
  // month (the "same month, so skip repeating it" version this replaced)
  // renders as literal "2026 (day: 14)" in at least one browser's Intl
  // implementation, not a sane short date.
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" };
  const startStr = start.toLocaleDateString("en-US", opts);
  const endStr = endD.toLocaleDateString("en-US", opts);
  return `${startStr} – ${endStr}`;
}

interface CalendarTask {
  id: number;
  task_name: string;
  due_date: string | null;
  status: string;
  category: string | null;
  account: string | null;
}

/** Shape of one row from GET /api/assigned-tasks's VA-facing branch — same as DashboardBoardView's RawAssigneeRow, trimmed to what this view needs. */
interface RawAssigneeRow {
  status: string;
  assigned_tasks: {
    id: number;
    task_name: string;
    due_date: string | null;
    status: string;
    category?: string | null;
    account?: string | null;
  } | null;
}

interface DashboardCalendarViewProps {
  userId: string;
  isAdmin: boolean;
  orgTimezone: string;
}

export default function DashboardCalendarView({ userId, isAdmin, orgTimezone }: DashboardCalendarViewProps) {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [weekStart, setWeekStart] = useState(() => weekStartFor(getDateInTimezone(orgTimezone)));

  const fetchTasks = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(isAdmin ? "/api/assigned-tasks?selfOnly=true" : "/api/assigned-tasks");
      if (!res.ok) return;
      const json = await res.json();
      const rows: RawAssigneeRow[] = json.tasks || [];
      setTasks(
        rows
          .map((r) => r.assigned_tasks)
          .filter((t): t is NonNullable<RawAssigneeRow["assigned_tasks"]> => Boolean(t))
          .map((t) => ({
            id: t.id,
            task_name: t.task_name,
            due_date: t.due_date,
            status: t.status,
            category: t.category ?? null,
            account: t.account ?? null,
          }))
      );
    } catch {
      // Calendar is non-critical — silently keep whatever was last loaded.
    } finally {
      setLoading(false);
    }
  }, [userId, isAdmin]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const todayStr = getDateInTimezone(orgTimezone);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStart, i)), [weekStart]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const day of weekDays) map.set(day, []);
    for (const t of tasks) {
      if (!t.due_date) continue;
      const day = t.due_date.slice(0, 10);
      const list = map.get(day);
      if (list) list.push(t);
    }
    return map;
  }, [tasks, weekDays]);

  const totalThisWeek = weekDays.reduce((sum, d) => sum + (tasksByDay.get(d)?.length ?? 0), 0);

  if (loading) return null;

  const taskMeta = (t: CalendarTask) => [t.account, t.category].filter(Boolean).join(" · ");

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Calendar</h3>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setViewMode("board")}
            className={`px-3 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
              viewMode === "board" ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
            }`}
          >
            Board
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`px-3 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
              viewMode === "list" ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
            }`}
          >
            List
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setWeekStart((d) => addDaysToDateStr(d, -7))}
            className="px-2 py-1 rounded-lg text-[11px] font-semibold text-stone hover:bg-stone/10 transition-colors"
            aria-label="Previous week"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(weekStartFor(getDateInTimezone(orgTimezone)))}
            className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
          >
            This week
          </button>
          <button
            type="button"
            onClick={() => setWeekStart((d) => addDaysToDateStr(d, 7))}
            className="px-2 py-1 rounded-lg text-[11px] font-semibold text-stone hover:bg-stone/10 transition-colors"
            aria-label="Next week"
          >
            →
          </button>
        </div>
        <span className="text-[11px] font-semibold text-walnut">{formatRangeLabel(weekStart)}</span>
      </div>

      {totalThisWeek === 0 ? (
        <p className="py-6 text-center text-[12px] text-stone">No tasks due this week.</p>
      ) : viewMode === "board" ? (
        <div className="grid grid-cols-7 gap-2 overflow-x-auto">
          {weekDays.map((day) => {
            const { weekday, day: dayNum } = formatDayHeader(day);
            const isToday = day === todayStr;
            const dayTasks = tasksByDay.get(day) ?? [];
            return (
              <div key={day} className="min-w-[110px] space-y-1.5">
                <div
                  className={`text-center rounded-lg py-1 text-[10px] font-semibold uppercase tracking-wide ${
                    isToday ? "bg-sage-soft text-sage" : "text-walnut"
                  }`}
                >
                  {weekday} {dayNum}
                </div>
                <div className="space-y-1.5 min-h-[20px]">
                  {dayTasks.map((t) => (
                    <div key={t.id} className="rounded-lg border border-sand bg-white px-2 py-1.5 space-y-1">
                      <p className="text-[10px] font-semibold text-espresso leading-tight line-clamp-2">
                        {t.task_name}
                      </p>
                      <StatusBadge status={t.status} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {weekDays
            .filter((day) => (tasksByDay.get(day)?.length ?? 0) > 0)
            .map((day) => {
              const { weekday, day: dayNum } = formatDayHeader(day);
              const isToday = day === todayStr;
              return (
                <div key={day} className="space-y-1.5">
                  <p
                    className={`text-[10px] font-semibold uppercase tracking-wide ${
                      isToday ? "text-sage" : "text-walnut"
                    }`}
                  >
                    {weekday}, {new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                    {isToday ? " · Today" : ""}
                  </p>
                  {(tasksByDay.get(day) ?? []).map((t) => (
                    <div
                      key={t.id}
                      className="flex items-start justify-between gap-2 py-2 px-3 rounded-lg border border-sand bg-white"
                    >
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-espresso leading-tight">{t.task_name}</p>
                        {taskMeta(t) && <p className="text-[10px] text-stone/80 mt-0.5">{taskMeta(t)}</p>}
                      </div>
                      <StatusBadge status={t.status} />
                    </div>
                  ))}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
