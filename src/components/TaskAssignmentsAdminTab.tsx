"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type {
  Profile,
  AssignedTaskWithAssignees,
  AssignedTaskStatus,
} from "@/types/database";

// ─── Constants ────────────────────────────────────────────────────────────────

const KNOWN_ACCOUNTS = [
  "TAT Foundation",
  "WSB Awesome Team",
  "Virtual Concierge",
  "Colina Portrait",
  "SNAPS Sublimation",
  "Thess Personal",
  "Thess Base",
  "Right Path Agency",
  "Personal",
  "Quad Life",
  "TONIWSB",
];

const STATUS_OPTIONS: { value: AssignedTaskStatus | ""; label: string }[] = [
  { value: "", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "on_queue", label: "On Queue" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskAssignmentsAdminTabProps {
  profiles: Profile[];
  orgTimezone?: string;
}

interface FormState {
  task_name: string;
  account: string;
  project: string;
  task_detail: string;
  due_date: string;
  assignee_ids: string[];
}

interface CsvRow {
  task_name: string;
  account: string;
  project: string;
  task_detail: string;
  due_date: string;
  va_usernames: string[];
  _valid: boolean;
  _error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDueDate(iso: string | null, tz?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: tz || undefined,
    });
  } catch {
    return iso;
  }
}

function isDueSoon(iso: string | null): boolean {
  if (!iso) return false;
  const diff = new Date(iso).getTime() - Date.now();
  return diff >= 0 && diff < 86400 * 3 * 1000; // within 3 days
}

function isPastDue(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AssignedTaskStatus }) {
  const map: Record<AssignedTaskStatus, { cls: string; label: string }> = {
    pending: { cls: "bg-stone/10 text-stone", label: "Pending" },
    on_queue: { cls: "bg-slate-blue-soft text-slate-blue", label: "On Queue" },
    in_progress: { cls: "bg-amber-100 text-amber-700", label: "In Progress" },
    completed: { cls: "bg-sage-soft text-sage", label: "Completed" },
    cancelled: { cls: "bg-terracotta-soft text-terracotta", label: "Cancelled" },
  };
  const { cls, label } = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

// ─── Empty skeleton rows ──────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl border border-sand bg-white p-5 shadow-sm animate-pulse">
          <div className="h-4 bg-sand rounded w-1/3 mb-3" />
          <div className="h-3 bg-sand rounded w-1/2 mb-2" />
          <div className="h-3 bg-sand rounded w-1/4" />
        </div>
      ))}
    </div>
  );
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

function parseCsv(text: string, vaProfiles: Profile[]): CsvRow[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  // Skip header line
  const dataLines = lines.slice(1);
  const rows: CsvRow[] = [];

  for (const raw of dataLines) {
    if (!raw.trim()) continue;

    // Simple CSV parse that handles quoted fields
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '"') {
        if (inQuotes && raw[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());

    const [task_name = "", account = "", project = "", task_detail = "", due_date = "", va_raw = ""] = fields;

    const va_usernames = va_raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    const unknownVas = va_usernames.filter(
      (u) => !vaProfiles.some((p) => p.username === u)
    );

    const valid = !!task_name.trim();
    const row: CsvRow = {
      task_name: task_name.trim(),
      account: account.trim(),
      project: project.trim(),
      task_detail: task_detail.trim(),
      due_date: due_date.trim(),
      va_usernames,
      _valid: valid,
    };

    if (!valid) {
      row._error = "task_name is required";
    } else if (unknownVas.length > 0) {
      row._error = `Unknown usernames: ${unknownVas.join(", ")}`;
      row._valid = false;
    }

    rows.push(row);
  }

  return rows;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TaskAssignmentsAdminTab({
  profiles,
  orgTimezone,
}: TaskAssignmentsAdminTabProps) {
  const vaProfiles = profiles.filter((p) => p.role === "va");

  // ── Data state ───────────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<AssignedTaskWithAssignees[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [deleting, setDeleting] = useState<Record<number, boolean>>({});

  // ── Filter state ─────────────────────────────────────────────────────────────
  const [filterVaId, setFilterVaId] = useState("");
  const [filterStatus, setFilterStatus] = useState<AssignedTaskStatus | "">("");

  // ── Form state ───────────────────────────────────────────────────────────────
  const emptyForm = (): FormState => ({
    task_name: "",
    account: "",
    project: "",
    task_detail: "",
    due_date: "",
    assignee_ids: [],
  });

  const [form, setForm] = useState<FormState>(emptyForm());

  // ── CSV Upload state ─────────────────────────────────────────────────────────
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState<string | null>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);

  // ─── Fetch tasks ─────────────────────────────────────────────────────────────

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/assigned-tasks");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setTasks(d.tasks || d || []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // ─── Form helpers ─────────────────────────────────────────────────────────────

  const resetForm = () => {
    setForm(emptyForm());
    setEditingId(null);
    setSaveMsg(null);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (task: AssignedTaskWithAssignees) => {
    setEditingId(task.id);
    setForm({
      task_name: task.task_name,
      account: task.account || "",
      project: task.project || "",
      task_detail: task.task_detail || "",
      due_date: task.due_date ? task.due_date.slice(0, 10) : "",
      assignee_ids: task.assigned_task_assignees.map((a) => a.va_id),
    });
    setShowForm(true);
    setSaveMsg(null);
  };

  const toggleAssignee = (id: string) => {
    setForm((prev) => ({
      ...prev,
      assignee_ids: prev.assignee_ids.includes(id)
        ? prev.assignee_ids.filter((i) => i !== id)
        : [...prev.assignee_ids, id],
    }));
  };

  // ─── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!form.task_name.trim()) return;
    if (form.assignee_ids.length === 0) {
      setSaveMsg({ type: "err", text: "Please select at least one VA to assign this task to." });
      return;
    }
    setSaving(true);
    setSaveMsg(null);

    const payload = {
      task_name: form.task_name.trim(),
      account: form.account.trim() || null,
      project: form.project.trim() || null,
      task_detail: form.task_detail.trim() || null,
      due_date: form.due_date || null,
      va_ids: form.assignee_ids,
    };

    try {
      const res = editingId
        ? await fetch(`/api/assigned-tasks/${editingId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/assigned-tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (res.ok) {
        setSaveMsg({
          type: "ok",
          text: editingId ? "Task updated!" : "Task created!",
        });
        setTimeout(() => setSaveMsg(null), 3000);
        resetForm();
        setShowForm(false);
        fetchTasks();
      } else {
        const e = await res.json();
        setSaveMsg({ type: "err", text: e.error || "Failed to save" });
      }
    } catch {
      setSaveMsg({ type: "err", text: "Network error — please try again" });
    } finally {
      setSaving(false);
    }
  }, [form, editingId, fetchTasks]);

  // ─── Delete ───────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm("Delete this task? This cannot be undone.")) return;
      setDeleting((d) => ({ ...d, [id]: true }));
      try {
        await fetch(`/api/assigned-tasks/${id}`, { method: "DELETE" });
        await fetchTasks();
      } finally {
        setDeleting((d) => ({ ...d, [id]: false }));
      }
    },
    [fetchTasks]
  );

  // ─── CSV Upload ───────────────────────────────────────────────────────────────

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCsv(text, vaProfiles);
      setCsvRows(parsed);
      setCsvResult(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleCsvUpload = useCallback(async () => {
    const valid = csvRows.filter((r) => r._valid);
    if (valid.length === 0) return;

    setCsvUploading(true);
    setCsvResult(null);

    let created = 0;
    const errors: string[] = [];

    for (const row of valid) {
      const assignee_ids = row.va_usernames
        .map((u) => vaProfiles.find((p) => p.username === u)?.id)
        .filter((id): id is string => !!id);

      const payload = {
        task_name: row.task_name,
        account: row.account || null,
        project: row.project || null,
        task_detail: row.task_detail || null,
        due_date: row.due_date || null,
        va_ids: assignee_ids,
      };

      try {
        const res = await fetch("/api/assigned-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          created++;
        } else {
          const e = await res.json();
          errors.push(`"${row.task_name}": ${e.error || "failed"}`);
        }
      } catch {
        errors.push(`"${row.task_name}": network error`);
      }
    }

    setCsvUploading(false);

    if (errors.length > 0) {
      setCsvResult(
        `Created ${created} task(s). Errors:\n${errors.join("\n")}`
      );
    } else {
      setCsvResult(`Created ${created} task(s) successfully.`);
      setTimeout(() => {
        setShowCsvModal(false);
        setCsvRows([]);
        setCsvResult(null);
      }, 2000);
    }

    if (created > 0) fetchTasks();
  }, [csvRows, vaProfiles, fetchTasks]);

  // ─── Filtered tasks ───────────────────────────────────────────────────────────

  const filteredTasks = tasks.filter((task) => {
    if (filterVaId) {
      const hasVa = task.assigned_task_assignees.some((a) => a.va_id === filterVaId);
      if (!hasVa) return false;
    }
    if (filterStatus) {
      const hasStatus = task.assigned_task_assignees.some(
        (a) => a.status === filterStatus
      );
      if (!hasStatus) return false;
    }
    return true;
  });

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl space-y-6">
      {/* ── Header row ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filterVaId}
            onChange={(e) => setFilterVaId(e.target.value)}
            className="py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta cursor-pointer"
          >
            <option value="">All VAs</option>
            {vaProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.username}
              </option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(e.target.value as AssignedTaskStatus | "")
            }
            className="py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta cursor-pointer"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowCsvModal(true);
              setCsvRows([]);
              setCsvResult(null);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-sand px-4 py-2.5 text-[13px] font-semibold text-walnut cursor-pointer transition-all hover:border-walnut"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            Bulk Upload (CSV)
          </button>

          <button
            onClick={() => {
              resetForm();
              setShowForm(!showForm);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840]"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create Task
          </button>
        </div>
      </div>

      {/* ── Create / Edit Form ──────────────────────────────────────────────────── */}
      {showForm && (
        <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-espresso mb-4">
            {editingId ? "Edit Task" : "New Assigned Task"}
          </h3>

          <div className="space-y-4">
            {/* Task Name */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">
                Task Name *
              </label>
              <input
                type="text"
                value={form.task_name}
                onChange={(e) => setForm((f) => ({ ...f, task_name: e.target.value }))}
                placeholder="What needs to be done?"
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
              />
            </div>

            {/* Account + Project in a row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">
                  Account
                </label>
                <input
                  type="text"
                  list="known-accounts-list"
                  value={form.account}
                  onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}
                  placeholder="Account name"
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                />
                <datalist id="known-accounts-list">
                  {KNOWN_ACCOUNTS.map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">
                  Project
                </label>
                <input
                  type="text"
                  value={form.project}
                  onChange={(e) => setForm((f) => ({ ...f, project: e.target.value }))}
                  placeholder="Project name"
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                />
              </div>
            </div>

            {/* Task Detail */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">
                Task Detail
              </label>
              <textarea
                value={form.task_detail}
                onChange={(e) => setForm((f) => ({ ...f, task_detail: e.target.value }))}
                rows={4}
                placeholder="Instructions, notes, or context..."
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta resize-none"
              />
            </div>

            {/* Due Date */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">
                Due Date
              </label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                className="py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta cursor-pointer"
              />
            </div>

            {/* Assign To */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-2 tracking-wide">
                Assign To <span className="text-terracotta">*</span>
              </label>
              {vaProfiles.length === 0 ? (
                <p className="text-[12px] text-stone">No VAs available</p>
              ) : (
                <div className="space-y-1.5">
                  {vaProfiles.map((va) => (
                    <label key={va.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.assignee_ids.includes(va.id)}
                        onChange={() => toggleAssignee(va.id)}
                        className="accent-terracotta"
                      />
                      <span className="text-[13px] text-walnut">
                        {va.full_name || va.username}
                      </span>
                      {va.position && (
                        <span className="text-[11px] text-stone">
                          {va.position}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 mt-5 flex-wrap">
            <button
              onClick={handleSave}
              disabled={saving || !form.task_name.trim() || form.assignee_ids.length === 0}
              className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : editingId ? "Save Changes" : "Create Task"}
            </button>

            <button
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
              className="text-xs text-stone hover:text-espresso cursor-pointer"
            >
              Cancel
            </button>

            {saveMsg && (
              <p
                className={`text-xs font-medium ${
                  saveMsg.type === "ok" ? "text-sage" : "text-red-500"
                }`}
              >
                {saveMsg.text}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Loading skeleton ────────────────────────────────────────────────────── */}
      {loading && <SkeletonRows />}

      {/* ── Fetch error ─────────────────────────────────────────────────────────── */}
      {!loading && fetchError && (
        <div className="rounded-xl border border-sand bg-white p-5 shadow-sm text-center">
          <p className="text-sm text-red-500">{fetchError}</p>
          <button
            onClick={fetchTasks}
            className="mt-2 text-xs text-terracotta hover:underline cursor-pointer"
          >
            Try again
          </button>
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────────────── */}
      {!loading && !fetchError && filteredTasks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-espresso">
            {tasks.length === 0 ? "No tasks assigned yet" : "No tasks match your filters"}
          </p>
          <p className="mt-1 text-xs text-stone">
            {tasks.length === 0
              ? "Click \"Create Task\" to assign the first task."
              : "Try adjusting your filters."}
          </p>
        </div>
      )}

      {/* ── Task list ───────────────────────────────────────────────────────────── */}
      {!loading && !fetchError && filteredTasks.length > 0 && (
        <div className="space-y-4">
          {filteredTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              orgTimezone={orgTimezone}
              deleting={!!deleting[task.id]}
              onEdit={openEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* ── CSV Modal ───────────────────────────────────────────────────────────── */}
      {showCsvModal && (
        <CsvModal
          vaProfiles={vaProfiles}
          csvRows={csvRows}
          csvUploading={csvUploading}
          csvResult={csvResult}
          fileRef={csvFileRef}
          onFileChange={handleCsvFile}
          onUpload={handleCsvUpload}
          onClose={() => {
            setShowCsvModal(false);
            setCsvRows([]);
            setCsvResult(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: AssignedTaskWithAssignees;
  orgTimezone?: string;
  deleting: boolean;
  onEdit: (task: AssignedTaskWithAssignees) => void;
  onDelete: (id: number) => void;
}

function TaskCard({ task, orgTimezone, deleting, onEdit, onDelete }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);

  const dueDateStr = fmtDueDate(task.due_date, orgTimezone);
  const dueSoon = isDueSoon(task.due_date);
  const pastDue = isPastDue(task.due_date);

  return (
    <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          {/* Task name + account/project */}
          <h3 className="text-sm font-semibold text-espresso">{task.task_name}</h3>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
            {task.account && (
              <span className="text-[12px] text-walnut font-medium">{task.account}</span>
            )}
            {task.account && task.project && (
              <span className="text-[11px] text-stone">/</span>
            )}
            {task.project && (
              <span className="text-[12px] text-bark">{task.project}</span>
            )}
          </div>

          {/* Due date */}
          {task.due_date && (
            <div className="mt-1.5">
              <span
                className={`text-[11px] font-medium ${
                  pastDue
                    ? "text-terracotta"
                    : dueSoon
                    ? "text-amber-600"
                    : "text-stone"
                }`}
              >
                Due {dueDateStr}
                {pastDue && " · Past Due"}
                {!pastDue && dueSoon && " · Soon"}
              </span>
            </div>
          )}
        </div>

        {/* Edit / Delete */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onEdit(task)}
            className="text-[11px] text-walnut hover:text-espresso cursor-pointer px-2 py-1 rounded border border-sand hover:border-walnut transition-all"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(task.id)}
            disabled={deleting}
            className="text-[11px] text-terracotta hover:text-red-600 cursor-pointer px-2 py-1 rounded border border-sand hover:border-terracotta transition-all disabled:opacity-50"
          >
            {deleting ? "..." : "Delete"}
          </button>
        </div>
      </div>

      {/* Task detail (collapsible) */}
      {task.task_detail && (
        <div className="mt-2 mb-3">
          <div
            className={`text-xs text-bark leading-relaxed whitespace-pre-wrap ${
              !expanded && task.task_detail.length > 180 ? "line-clamp-2" : ""
            }`}
          >
            {task.task_detail}
          </div>
          {task.task_detail.length > 180 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 text-[11px] text-terracotta hover:underline cursor-pointer"
            >
              {expanded ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      )}

      {/* Assignees */}
      {task.assigned_task_assignees.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {task.assigned_task_assignees.map((a) => {
            const name = a.profiles?.full_name || a.profiles?.username || a.va_id;
            return (
              <div
                key={a.id}
                className="flex items-center gap-1.5 rounded-full border border-sand px-2.5 py-0.5"
              >
                <span className="text-[12px] text-walnut font-medium">{name}</span>
                <StatusBadge status={a.status} />
              </div>
            );
          })}
        </div>
      )}

      {task.assigned_task_assignees.length === 0 && (
        <p className="text-[11px] text-stone mt-2">No assignees</p>
      )}
    </div>
  );
}

// ─── CSV Modal ────────────────────────────────────────────────────────────────

interface CsvModalProps {
  vaProfiles: Profile[];
  csvRows: CsvRow[];
  csvUploading: boolean;
  csvResult: string | null;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onUpload: () => void;
  onClose: () => void;
}

function CsvModal({
  vaProfiles: _vaProfiles,
  csvRows,
  csvUploading,
  csvResult,
  fileRef,
  onFileChange,
  onUpload,
  onClose,
}: CsvModalProps) {
  const validCount = csvRows.filter((r) => r._valid).length;
  const invalidCount = csvRows.filter((r) => !r._valid).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl flex flex-col max-h-[90vh]">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-sand shrink-0">
          <h2 className="text-sm font-bold text-espresso">Bulk Upload Tasks (CSV)</h2>
          <button
            onClick={onClose}
            className="text-stone hover:text-espresso cursor-pointer"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Modal body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Format instructions */}
          <div className="rounded-lg bg-parchment border border-sand p-4 space-y-2">
            <p className="text-[12px] font-semibold text-walnut">CSV Format</p>
            <p className="text-[11px] text-stone leading-relaxed">
              First row must be the header. Columns in order:
            </p>
            <code className="block text-[11px] bg-white border border-sand rounded px-3 py-2 text-bark font-mono">
              task_name, account, project, task_detail, due_date, va_usernames
            </code>
            <ul className="text-[11px] text-stone space-y-1 pl-4 list-disc">
              <li><strong>task_name</strong> — required</li>
              <li><strong>account</strong> — optional (e.g. TAT Foundation)</li>
              <li><strong>project</strong> — optional</li>
              <li><strong>task_detail</strong> — optional description/instructions</li>
              <li><strong>due_date</strong> — optional, format YYYY-MM-DD</li>
              <li>
                <strong>va_usernames</strong> — optional, comma-separated VA usernames
                inside quotes. E.g.{" "}
                <code className="font-mono bg-sand/50 px-1 rounded">&quot;alice,bob&quot;</code>
              </li>
            </ul>
            <p className="text-[11px] text-stone">
              Example row:{" "}
              <code className="font-mono bg-sand/50 px-1 rounded text-[10px]">
                Design landing page,TAT Foundation,Website,,2026-06-20,&quot;alice,bob&quot;
              </code>
            </p>
          </div>

          {/* File picker */}
          {csvRows.length === 0 && (
            <label className="flex items-center gap-2 cursor-pointer w-fit rounded-lg border border-sand px-4 py-2.5 text-[13px] text-walnut hover:border-walnut transition-all">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Choose CSV file
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={onFileChange}
              />
            </label>
          )}

          {/* Preview table */}
          {csvRows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-semibold text-walnut">
                  Preview — {csvRows.length} row(s)
                  {validCount > 0 && (
                    <span className="text-sage ml-2">{validCount} valid</span>
                  )}
                  {invalidCount > 0 && (
                    <span className="text-terracotta ml-2">{invalidCount} invalid</span>
                  )}
                </p>
                <label className="text-[11px] text-terracotta hover:underline cursor-pointer">
                  Replace file
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={onFileChange}
                  />
                </label>
              </div>

              <div className="overflow-x-auto rounded-lg border border-sand">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-parchment border-b border-sand">
                      <th className="text-left px-3 py-2 text-walnut font-semibold">Task</th>
                      <th className="text-left px-3 py-2 text-walnut font-semibold">Account</th>
                      <th className="text-left px-3 py-2 text-walnut font-semibold">Due</th>
                      <th className="text-left px-3 py-2 text-walnut font-semibold">VAs</th>
                      <th className="text-left px-3 py-2 text-walnut font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.map((row, i) => (
                      <tr
                        key={i}
                        className={`border-b border-sand last:border-0 ${
                          row._valid ? "" : "bg-red-50"
                        }`}
                      >
                        <td className="px-3 py-2 text-ink font-medium">
                          {row.task_name || <span className="text-stone italic">empty</span>}
                        </td>
                        <td className="px-3 py-2 text-bark">{row.account || "—"}</td>
                        <td className="px-3 py-2 text-bark">{row.due_date || "—"}</td>
                        <td className="px-3 py-2 text-bark">
                          {row.va_usernames.length > 0
                            ? row.va_usernames.join(", ")
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {row._valid ? (
                            <span className="text-sage font-semibold">OK</span>
                          ) : (
                            <span className="text-red-500">{row._error || "Invalid"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Result message */}
          {csvResult && (
            <div
              className={`rounded-lg px-4 py-3 text-[12px] whitespace-pre-wrap ${
                csvResult.includes("Error")
                  ? "bg-red-50 text-red-600"
                  : "bg-sage-soft text-sage"
              }`}
            >
              {csvResult}
            </div>
          )}
        </div>

        {/* Modal footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-sand shrink-0">
          <button
            onClick={onClose}
            className="text-xs text-stone hover:text-espresso cursor-pointer"
          >
            Cancel
          </button>

          {csvRows.length > 0 && validCount > 0 && (
            <button
              onClick={onUpload}
              disabled={csvUploading}
              className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {csvUploading
                ? "Uploading..."
                : `Upload ${validCount} Task${validCount !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
