"use client";

// Personal Board View for the Dashboard — shows the signed-in user's own
// assigned tasks (plus collaborative ones, same as AssignedTasksWidget) as a
// Kanban board, with a toggle for Objective / Operations / Both / Adhoc
// (Toni's call, 2026-11-11 — Adhoc used to be its own always-shown board
// below this one regardless of the toggle; it's just a 4th toggle choice now).
//
// Reuses the same board machinery as the Objective/Operations pages
// (SubtaskBoardView + BOARD_COLUMNS) rather than inventing a second one.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SubtaskBoardView from "@/components/SubtaskBoardView";
import TaskDetailsView from "@/components/TaskDetailsView";
import TaskEditor, { type TaskEditorHandle } from "@/components/TaskEditor";
import type { SubtaskRow } from "@/components/VAProjectsTab";
import type { Profile, ProjectKind } from "@/types/database";
import { addDaysToDateStr, getDateInTimezone } from "@/lib/taskSchedule";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// Same classes as VAProjectsTab's STATUS_CLASSES / AGENTS.md's documented
// assigned_tasks status badge palette — not re-derived.
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
const PAID_MANUAL_CLASS = "bg-orange-50 text-orange-600 border-orange-200";

function StatusBadge({ status, paidManually = false }: { status: string; paidManually?: boolean }) {
  const cls =
    status === "paid" && paidManually
      ? PAID_MANUAL_CLASS
      : STATUS_CLASSES[status] ?? "bg-stone/10 text-stone border-stone/20";
  return (
    <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// Calendar tab — ported from the standalone DashboardCalendarView (Toni's
// call, 2026-11-16: folded in as a second tab here instead of its own
// section below, sourced from this component's own already-fetched tasks
// instead of a separate fetch).
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
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" };
  return `${start.toLocaleDateString("en-US", opts)} – ${endD.toLocaleDateString("en-US", opts)}`;
}

// Raw shape of one row from GET /api/assigned-tasks's VA-facing branch
// (own assignee row, with the parent task nested under assigned_tasks).
interface RawAssigneeRow {
  va_id: string;
  status: string;
  assigned_tasks: {
    id: number;
    task_name: string;
    due_date: string | null;
    start_date?: string | null;
    created_at: string | null;
    status: string;
    paid_manually?: boolean | null;
    pay_type?: string | null;
    category?: string | null;
    project?: string | null;
    project_id?: string | null;
    task_detail?: string | null;
    task_notes?: string | null;
    instructions?: string | null;
    account?: string | null;
    assigned_by: string | null;
    created_by?: string | null;
    review_required?: boolean;
    recurring_template_id?: string | null;
    projects?: { id: string; name: string; kind: ProjectKind } | null;
  } | null;
}

type Bucket = "objective" | "operation" | "adhoc";

function toSubtaskRow(row: RawAssigneeRow): { sub: SubtaskRow; bucket: Bucket } | null {
  const task = row.assigned_tasks;
  if (!task) return null;
  const bucket: Bucket = task.project_id ? (task.projects?.kind === "operation" ? "operation" : "objective") : "adhoc";
  const sub: SubtaskRow = {
    id: task.id,
    task_name: task.task_name,
    due_date: task.due_date,
    start_date: task.start_date,
    created_at: task.created_at,
    status: task.status,
    paid_manually: task.paid_manually,
    pay_type: task.pay_type,
    category: task.category,
    project: task.project,
    project_id: task.project_id,
    task_detail: task.task_detail,
    task_notes: task.task_notes,
    instructions: task.instructions,
    account: task.account,
    assigned_by: task.assigned_by,
    created_by: task.created_by,
    review_required: task.review_required,
    recurring_template_id: task.recurring_template_id,
    assigned_task_assignees: [{ va_id: row.va_id, status: row.status }],
  };
  return { sub, bucket };
}

const TOGGLE_OPTIONS: { value: "objective" | "operation" | "both" | "adhoc" | "all"; label: string }[] = [
  { value: "objective", label: "Objective" },
  { value: "operation", label: "Operations" },
  { value: "both", label: "Both" },
  { value: "adhoc", label: "Adhoc" },
  { value: "all", label: "All" },
];

// Admin's "View by VA" (Toni's call, 2026-11-16) — the board otherwise only
// ever shows the signed-in user's own tasks (even for admins, via
// selfOnly=true below). Picking one or more VAs here switches it to show
// theirs instead — one ?viewAsVa=<id> request per selected VA (same
// admin-gated route desktop's own View as VA already uses, and the same
// RawAssigneeRow/toSubtaskRow shape as the self-fetch below), merged
// client-side since there's no multi-id version of that param.
//
// Deliberately NOT the unscoped full-org fetch (no vaId/viewAsVa at all):
// tried that first, but it's ordered by created_at with no explicit limit,
// which PostgREST caps by default — ordered newest-first, so anyone whose
// relevant tasks are older than that cutoff silently returns zero, found
// live when Shem Delgado's selection matched nothing despite having active
// work. Per-VA requests are naturally scoped and don't hit that cap.

interface DashboardBoardViewProps {
  userId: string;
  isAdmin: boolean;
  teamMembers: Profile[];
  orgTimezone: string;
  /** View-only caller (e.g. a client monitoring a VA's board) — cards open
   *  the read-only details view instead of the editor, and drag-to-complete
   *  is disabled. Everything else (the View by VA filter, the board itself)
   *  behaves the same. */
  readOnly?: boolean;
}

export default function DashboardBoardView({ userId, isAdmin, teamMembers, orgTimezone, readOnly = false }: DashboardBoardViewProps) {
  const [loading, setLoading] = useState(true);
  const [buckets, setBuckets] = useState<{ objective: SubtaskRow[]; operation: SubtaskRow[]; adhoc: SubtaskRow[] }>({
    objective: [],
    operation: [],
    adhoc: [],
  });
  const [toggle, setToggle] = useState<"objective" | "operation" | "both" | "adhoc" | "all">("both");
  // Board and Calendar are one card with two tabs now (Toni's call,
  // 2026-11-16) — Calendar used to be its own separate section below.
  const [mainTab, setMainTab] = useState<"board" | "calendar">("board");
  const [calendarViewMode, setCalendarViewMode] = useState<"board" | "list">("board");
  const [weekStart, setWeekStart] = useState(() => weekStartFor(getDateInTimezone(orgTimezone)));
  const [editingSubId, setEditingSubId] = useState<number | null>(null);
  // Clicking a Calendar task opens it read-only first — same TaskDetailsView
  // "what is this?" step Productivity's own task surfaces use, with Edit one
  // click away from there. The Board tab's kanban cards skip straight to
  // Edit, unchanged — that already matches Productivity's own kanban board.
  const [viewingSubId, setViewingSubId] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState("pending");
  const [savingSub, setSavingSub] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<"main" | null>(null);
  // Collapsed state is purely visual — the board keeps fetching/polling
  // underneath, same as the Subtasks reference list's own ▶/▼ toggle this
  // mirrors, so expanding it again never shows stale data.
  const [collapsed, setCollapsed] = useState(false);
  // Admin's "View by VA" multiselect — expanded by default, same as the
  // board itself, but its own collapse so it can be tucked away once set.
  const [vaFilterCollapsed, setVaFilterCollapsed] = useState(false);
  const [selectedVaIds, setSelectedVaIds] = useState<Set<string>>(new Set());
  const editTaskEditorRef = useRef<TaskEditorHandle | null>(null);

  const allSubtasks = [...buckets.objective, ...buckets.operation, ...buckets.adhoc];
  const viewingOtherVas = isAdmin && selectedVaIds.size > 0;

  const todayStr = getDateInTimezone(orgTimezone);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStart, i)), [weekStart]);
  const tasksByDay = useMemo(() => {
    const map = new Map<string, SubtaskRow[]>();
    for (const day of weekDays) map.set(day, []);
    for (const t of allSubtasks) {
      if (!t.due_date) continue;
      const day = t.due_date.slice(0, 10);
      map.get(day)?.push(t);
    }
    return map;
  }, [allSubtasks, weekDays]);
  const totalThisWeek = weekDays.reduce((sum, d) => sum + (tasksByDay.get(d)?.length ?? 0), 0);

  const toggleVaId = (vaId: string) => {
    setSelectedVaIds((prev) => {
      const next = new Set(prev);
      if (next.has(vaId)) next.delete(vaId);
      else next.add(vaId);
      return next;
    });
  };

  const fetchBoard = useCallback(async () => {
    if (!userId) return;
    try {
      if (viewingOtherVas) {
        const next = { objective: [] as SubtaskRow[], operation: [] as SubtaskRow[], adhoc: [] as SubtaskRow[] };
        await Promise.all(
          Array.from(selectedVaIds).map(async (vaId) => {
            const res = await fetch(`/api/assigned-tasks?viewAsVa=${vaId}`);
            if (!res.ok) return;
            const json = await res.json();
            const rows: RawAssigneeRow[] = json.tasks || [];
            for (const row of rows) {
              const mapped = toSubtaskRow(row);
              if (mapped) next[mapped.bucket].push(mapped.sub);
            }
          })
        );
        setBuckets(next);
        return;
      }

      const res = await fetch(isAdmin ? "/api/assigned-tasks?selfOnly=true" : "/api/assigned-tasks");
      if (!res.ok) return;
      const json = await res.json();
      const rows: RawAssigneeRow[] = json.tasks || [];
      const next = { objective: [] as SubtaskRow[], operation: [] as SubtaskRow[], adhoc: [] as SubtaskRow[] };
      for (const row of rows) {
        const mapped = toSubtaskRow(row);
        if (mapped) next[mapped.bucket].push(mapped.sub);
      }
      setBuckets(next);
    } catch {
      // Board is non-critical — silently keep whatever was last loaded.
    } finally {
      setLoading(false);
    }
  }, [userId, isAdmin, viewingOtherVas, selectedVaIds]);

  useEffect(() => {
    void fetchBoard();
  }, [fetchBoard]);

  const scopedSubtasks =
    toggle === "objective"
      ? buckets.objective
      : toggle === "operation"
        ? buckets.operation
        : toggle === "adhoc"
          ? buckets.adhoc
          : toggle === "all"
            ? [...buckets.objective, ...buckets.operation, ...buckets.adhoc]
            : [...buckets.objective, ...buckets.operation];

  const openEdit = (sub: SubtaskRow) => {
    setViewingSubId(null);
    setEditingSubId(sub.id);
    setEditStatus(sub.status ?? "pending");
    setEditError(null);
  };

  const openView = (sub: SubtaskRow) => {
    setEditingSubId(null);
    setViewingSubId(sub.id);
  };

  const handleMoveStatus = useCallback(async (subtaskId: number, toStatus: string) => {
    setBuckets((prev) => {
      const patch = (list: SubtaskRow[]) =>
        list.map((t) => (t.id === subtaskId
          ? { ...t, status: toStatus, assigned_task_assignees: (t.assigned_task_assignees ?? []).map((a) => ({ ...a, status: toStatus })) }
          : t));
      return { objective: patch(prev.objective), operation: patch(prev.operation), adhoc: patch(prev.adhoc) };
    });
    try {
      const res = await fetch(`/api/assigned-tasks/${subtaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: toStatus }),
      });
      if (!res.ok) throw new Error();
    } catch {
      void fetchBoard();
    }
  }, [fetchBoard]);

  const handleSaveEdit = async () => {
    if (!editingSubId) return;
    setSavingSub(true);
    setEditError(null);
    try {
      await editTaskEditorRef.current?.submit();
      const res = await fetch(`/api/assigned-tasks/${editingSubId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: editStatus }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setEditingSubId(null);
      void fetchBoard();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSavingSub(false);
    }
  };

  if (loading) return null;
  // Admins keep the board (and its View by VA filter) even with zero
  // personal tasks of their own — otherwise there'd be no way to reach the
  // filter at all once their own board is empty.
  if (!isAdmin && allSubtasks.length === 0) return null;

  const editingSub = editingSubId != null ? allSubtasks.find((s) => s.id === editingSubId) : null;
  const viewingSub = viewingSubId != null ? allSubtasks.find((s) => s.id === viewingSubId) : null;

  const renderDetailsPanel = () => {
    if (!viewingSub) return null;
    return (
      <div className="w-[360px] shrink-0 space-y-3 rounded-lg border border-sand bg-parchment p-3">
        <TaskDetailsView
          task={viewingSub as unknown as Parameters<typeof TaskDetailsView>[0]["task"]}
          people={teamMembers}
          onEdit={readOnly ? undefined : () => openEdit(viewingSub)}
        />
        <button
          onClick={() => setViewingSubId(null)}
          className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
        >
          Close
        </button>
      </div>
    );
  };

  const renderEditPanel = (expanded: boolean) => {
    if (!editingSub) return null;
    return (
      <div className={`space-y-3 rounded-lg border border-sand bg-parchment p-3 ${expanded ? "w-[440px] shrink-0 overflow-y-auto" : "w-[360px] shrink-0"}`}>
        <TaskEditor
          key={`dash-board-edit-${editingSub.id}`}
          ref={editTaskEditorRef}
          mode="time_based"
          editingTaskId={editingSub.id}
          initialTask={editingSub as unknown as Record<string, unknown>}
          currentUserId={userId}
          isAdminOrManager={isAdmin}
          teamMembers={teamMembers}
          lockedProjectId={isAdmin ? undefined : editingSub.project_id ?? undefined}
          hideFooter
          onCancel={() => setEditingSubId(null)}
          onSaved={() => {}}
        />

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
            Status
          </label>
          <select
            value={editStatus}
            onChange={(e) => setEditStatus(e.target.value)}
            className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white"
          >
            {["unassigned", "pending", "on_queue", "in_progress", "submitted", "reviewing", "revision_needed", "approved", "completed", "paid", "cancelled"].map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>

        {editError && <p className="text-[11px] text-red-600">{editError}</p>}

        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleSaveEdit()}
            disabled={savingSub}
            className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
          >
            {savingSub ? "Saving..." : "Save"}
          </button>
          <button
            onClick={() => setEditingSubId(null)}
            className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  const mainExpanded = expandedSection === "main";

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center cursor-pointer"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            <span className="text-bark text-[9px] w-3 shrink-0">{collapsed ? "▶" : "▼"}</span>
          </button>
          {([["board", "Board View"], ["calendar", "Calendar"]] as const).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMainTab(tab)}
              className={`px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors cursor-pointer ${
                mainTab === tab ? "bg-terracotta-soft text-terracotta" : "text-espresso hover:bg-parchment"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {!collapsed && (
          <div className="flex items-center gap-1.5">
            {mainTab === "board"
              ? TOGGLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setToggle(opt.value)}
                    className={`px-3 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                      toggle === opt.value ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))
              : (["board", "list"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setCalendarViewMode(v)}
                    className={`px-3 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                      calendarViewMode === v ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
                    }`}
                  >
                    {v === "board" ? "Board" : "List"}
                  </button>
                ))}
          </div>
        )}
      </div>

      {!collapsed && mainTab === "calendar" && (
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
      )}

      {!collapsed && isAdmin && teamMembers.length > 0 && (
        <div className="rounded-lg border border-sand bg-parchment/40">
          <div className="flex items-center justify-between px-3 py-2">
            <button
              type="button"
              onClick={() => setVaFilterCollapsed((v) => !v)}
              className="flex items-center gap-1.5 cursor-pointer"
            >
              <span className="text-bark text-[9px] w-2 shrink-0">{vaFilterCollapsed ? "▶" : "▼"}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-walnut">View by VA</span>
              {selectedVaIds.size > 0 && (
                <span className="rounded-full bg-sage-soft px-1.5 py-[1px] text-[9px] font-semibold text-sage">
                  {selectedVaIds.size}
                </span>
              )}
            </button>
            {selectedVaIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedVaIds(new Set())}
                className="text-[10px] font-semibold text-terracotta hover:underline cursor-pointer"
              >
                Clear — back to my own
              </button>
            )}
          </div>
          {!vaFilterCollapsed && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">
              {teamMembers
                .filter((p) => p.id !== userId)
                .slice()
                .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""))
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleVaId(p.id)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-all cursor-pointer ${
                      selectedVaIds.has(p.id)
                        ? "bg-espresso text-cream border-espresso"
                        : "border-sand bg-white text-bark hover:border-terracotta hover:text-terracotta"
                    }`}
                  >
                    {p.full_name}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {!collapsed && mainTab === "board" && (
        <div className={mainExpanded ? "fixed inset-0 z-50 flex gap-4 bg-cream p-6 overflow-auto" : "flex gap-4"}>
          <div className={mainExpanded ? "flex-1 min-w-0 overflow-auto" : "flex-1 min-w-0"}>
            <SubtaskBoardView
              subtasks={scopedSubtasks}
              editingSubId={editingSubId}
              onOpenEdit={readOnly ? openView : openEdit}
              formatDate={formatDate}
              StatusBadge={StatusBadge}
              activeProfiles={teamMembers}
              onMoveStatus={readOnly ? undefined : handleMoveStatus}
              currentUserId={userId}
              canSetSitewide={false}
              expanded={mainExpanded}
              onToggleExpanded={() => setExpandedSection((v) => (v === "main" ? null : "main"))}
            />
          </div>
          {viewingSub ? renderDetailsPanel() : renderEditPanel(mainExpanded)}
        </div>
      )}

      {!collapsed && mainTab === "calendar" && (
        <div className="flex gap-4">
          <div className="flex-1 min-w-0">
            {totalThisWeek === 0 ? (
              <p className="py-6 text-center text-[12px] text-stone">No tasks due this week.</p>
            ) : calendarViewMode === "board" ? (
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
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => openView(t)}
                            className={`w-full text-left rounded-lg border px-2 py-1.5 space-y-1 transition-colors cursor-pointer ${
                              viewingSubId === t.id || editingSubId === t.id
                                ? "border-terracotta bg-cream"
                                : "border-sand bg-white hover:bg-cream"
                            }`}
                          >
                            <p className="text-[10px] font-semibold text-espresso leading-tight line-clamp-2">
                              {t.task_name}
                            </p>
                            <StatusBadge status={t.status} />
                          </button>
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
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => openView(t)}
                            className={`flex w-full items-start justify-between gap-2 py-2 px-3 rounded-lg border text-left transition-colors cursor-pointer ${
                              viewingSubId === t.id || editingSubId === t.id
                                ? "border-terracotta bg-cream"
                                : "border-sand bg-white hover:bg-cream"
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="text-[12px] font-semibold text-espresso leading-tight">{t.task_name}</p>
                              {[t.account, t.category].filter(Boolean).join(" · ") && (
                                <p className="text-[10px] text-stone/80 mt-0.5">
                                  {[t.account, t.category].filter(Boolean).join(" · ")}
                                </p>
                              )}
                            </div>
                            <StatusBadge status={t.status} />
                          </button>
                        ))}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
          {viewingSub ? renderDetailsPanel() : renderEditPanel(false)}
        </div>
      )}
    </div>
  );
}
