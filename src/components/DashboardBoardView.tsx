"use client";

// Personal Board View for the Dashboard — shows the signed-in user's own
// assigned tasks (plus collaborative ones, same as AssignedTasksWidget) as a
// Kanban board, with a toggle for Objective / Operations / Both / Adhoc
// (Toni's call, 2026-11-11 — Adhoc used to be its own always-shown board
// below this one regardless of the toggle; it's just a 4th toggle choice now).
//
// Reuses the same board machinery as the Objective/Operations pages
// (SubtaskBoardView + BOARD_COLUMNS) rather than inventing a second one.

import { useCallback, useEffect, useRef, useState } from "react";
import SubtaskBoardView from "@/components/SubtaskBoardView";
import TaskEditor, { type TaskEditorHandle } from "@/components/TaskEditor";
import type { SubtaskRow } from "@/components/VAProjectsTab";
import type { Profile, ProjectKind } from "@/types/database";

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

const TOGGLE_OPTIONS: { value: "objective" | "operation" | "both" | "adhoc"; label: string }[] = [
  { value: "objective", label: "Objective" },
  { value: "operation", label: "Operations" },
  { value: "both", label: "Both" },
  { value: "adhoc", label: "Adhoc" },
];

interface DashboardBoardViewProps {
  userId: string;
  isAdmin: boolean;
  teamMembers: Profile[];
}

export default function DashboardBoardView({ userId, isAdmin, teamMembers }: DashboardBoardViewProps) {
  const [loading, setLoading] = useState(true);
  const [buckets, setBuckets] = useState<{ objective: SubtaskRow[]; operation: SubtaskRow[]; adhoc: SubtaskRow[] }>({
    objective: [],
    operation: [],
    adhoc: [],
  });
  const [toggle, setToggle] = useState<"objective" | "operation" | "both" | "adhoc">("both");
  const [editingSubId, setEditingSubId] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState("pending");
  const [savingSub, setSavingSub] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<"main" | null>(null);
  // Collapsed state is purely visual — the board keeps fetching/polling
  // underneath, same as the Subtasks reference list's own ▶/▼ toggle this
  // mirrors, so expanding it again never shows stale data.
  const [collapsed, setCollapsed] = useState(false);
  const editTaskEditorRef = useRef<TaskEditorHandle | null>(null);

  const allSubtasks = [...buckets.objective, ...buckets.operation, ...buckets.adhoc];

  const fetchBoard = useCallback(async () => {
    if (!userId) return;
    try {
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
  }, [userId, isAdmin]);

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
          : [...buckets.objective, ...buckets.operation];

  const openEdit = (sub: SubtaskRow) => {
    setEditingSubId(sub.id);
    setEditStatus(sub.status ?? "pending");
    setEditError(null);
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
  if (allSubtasks.length === 0) return null;

  const editingSub = editingSubId != null ? allSubtasks.find((s) => s.id === editingSubId) : null;

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
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1.5 cursor-pointer"
        >
          <span className="text-bark text-[9px] w-2 shrink-0">{collapsed ? "▶" : "▼"}</span>
          <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Board View</h3>
        </button>
        {!collapsed && (
          <div className="flex items-center gap-1.5">
            {TOGGLE_OPTIONS.map((opt) => (
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
            ))}
          </div>
        )}
      </div>

      {!collapsed && (
        <div className={mainExpanded ? "fixed inset-0 z-50 flex gap-4 bg-cream p-6 overflow-auto" : "flex gap-4"}>
          <div className={mainExpanded ? "flex-1 min-w-0 overflow-auto" : "flex-1 min-w-0"}>
            <SubtaskBoardView
              subtasks={scopedSubtasks}
              editingSubId={editingSubId}
              onOpenEdit={openEdit}
              formatDate={formatDate}
              StatusBadge={StatusBadge}
              activeProfiles={teamMembers}
              onMoveStatus={handleMoveStatus}
              currentUserId={userId}
              canSetSitewide={false}
              expanded={mainExpanded}
              onToggleExpanded={() => setExpandedSection((v) => (v === "main" ? null : "main"))}
            />
          </div>
          {renderEditPanel(mainExpanded)}
        </div>
      )}
    </div>
  );
}
