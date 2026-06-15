"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { FixedPayTaskAttachment, FixedPayTaskWithClaimer, Profile } from "@/types/database";

const ACTIVE_FILTER_PILLS: Array<{ value: "all" | "active" | "inactive"; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const STATUS_OPTIONS: Array<FixedPayTaskWithClaimer["status"]> = ["open", "in_progress", "completed", "cancelled"];
const STATUS_LABELS: Record<FixedPayTaskWithClaimer["status"], string> = {
  open: "Open",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
const STATUS_CLASSES: Record<FixedPayTaskWithClaimer["status"], string> = {
  open: "bg-slate-blue-soft text-slate-blue",
  in_progress: "bg-amber-100 text-amber-700",
  completed: "bg-sage-soft text-sage",
  cancelled: "bg-red-100 text-red-500",
};

const EMPTY_FORM = {
  task_name: "",
  account: "",
  category: "",
  rate: "",
  task_detail: "",
  task_notes: "",
  assigned_to: "",
  status: "open" as FixedPayTaskWithClaimer["status"],
  is_active: true,
};

type TaskFormState = typeof EMPTY_FORM;
type PanelMode = "create" | "edit" | null;
type ActiveFilter = "all" | "active" | "inactive";

type ProfileSummary = Pick<Profile, "id" | "full_name" | "username">;


function formatRate(rate: number | string | null | undefined) {
  const parsed = typeof rate === "number" ? rate : Number(rate ?? NaN);
  if (Number.isNaN(parsed)) return "—";
  return `$${parsed.toFixed(2)}`;
}

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAttachmentSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function taskToForm(task: FixedPayTaskWithClaimer): TaskFormState {
  return {
    task_name: task.task_name ?? "",
    account: task.account ?? "",
    category: task.category ?? "",
    rate: String(task.rate ?? ""),
    task_detail: task.task_detail ?? "",
    task_notes: task.task_notes ?? "",
    assigned_to: task.assigned_to ?? "",
    status: task.status ?? "open",
    is_active: task.is_active,
  };
}

function mergeTextOptions(options: string[], currentValue: string | null | undefined) {
  const set = new Set(options.filter(Boolean));
  if (currentValue) set.add(currentValue);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function mergeProfiles(options: ProfileSummary[], current: ProfileSummary | null | undefined) {
  const map = new Map<string, ProfileSummary>();
  for (const option of options) map.set(option.id, option);
  if (current) map.set(current.id, current);
  return Array.from(map.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export default function FixedPayTasksTab() {
  const [tasks, setTasks] = useState<FixedPayTaskWithClaimer[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");

  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [selectedTask, setSelectedTask] = useState<FixedPayTaskWithClaimer | null>(null);
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [accounts, setAccounts] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeProfiles, setActiveProfiles] = useState<ProfileSummary[]>([]);

  const [attachments, setAttachments] = useState<FixedPayTaskAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentMessage, setAttachmentMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/fixed-pay-tasks", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { tasks?: FixedPayTaskWithClaimer[] } | FixedPayTaskWithClaimer[];
      const rows = Array.isArray(json) ? json : json.tasks ?? [];
      setTasks(rows);
    } catch {
      setTasks([]);
      setMessage({ type: "err", text: "Unable to load fixed pay tasks." });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLookups = useCallback(async () => {
    try {
      const [accountsRes, categoriesRes, profilesRes] = await Promise.all([
        fetch("/api/task-form-options", { cache: "no-store" }),
        fetch("/api/task-categories", { cache: "no-store" }),
        fetch("/api/profiles?active=true", { cache: "no-store" }),
      ]);

      if (accountsRes.ok) {
        const data = (await accountsRes.json()) as { accounts?: string[] };
        setAccounts(data.accounts ?? []);
      }

      if (categoriesRes.ok) {
        const data = (await categoriesRes.json()) as { categories?: Array<{ category_name: string }> };
        setCategories((data.categories ?? []).map((category) => category.category_name));
      }

      if (profilesRes.ok) {
        const data = (await profilesRes.json()) as { profiles?: ProfileSummary[] };
        setActiveProfiles(data.profiles ?? []);
      }
    } catch {
      // Keep the form usable with values already present on tasks.
    }
  }, []);

  const fetchAttachments = useCallback(async (taskId: string | number) => {
    setAttachmentsLoading(true);
    try {
      const res = await fetch(`/api/fixed-pay-tasks/${taskId}/attachments`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { attachments?: FixedPayTaskAttachment[] };
      setAttachments(json.attachments ?? []);
    } catch {
      setAttachments([]);
    } finally {
      setAttachmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
    void fetchLookups();
  }, [fetchLookups, fetchTasks]);

  useEffect(() => {
    if (panelMode === "edit" && selectedTask) {
      void fetchAttachments(selectedTask.id);
      setPendingAttachment(null);
      setAttachmentMessage(null);
    } else {
      setAttachments([]);
      setPendingAttachment(null);
      setAttachmentMessage(null);
    }
  }, [fetchAttachments, panelMode, selectedTask]);

  const filteredTasks = useMemo(() => {
    if (activeFilter === "all") return tasks;
    if (activeFilter === "active") return tasks.filter((task) => task.is_active);
    return tasks.filter((task) => !task.is_active);
  }, [activeFilter, tasks]);

  const accountOptions = useMemo(() => mergeTextOptions(accounts, form.account), [accounts, form.account]);
  const categoryOptions = useMemo(() => mergeTextOptions(categories, form.category), [categories, form.category]);
  const selectedAssignedProfile = selectedTask?.assigned_to_profile ?? null;
  const vaOptions = useMemo(
    () => mergeProfiles(activeProfiles, selectedAssignedProfile),
    [selectedAssignedProfile, activeProfiles]
  );

  const openCreatePanel = useCallback(() => {
    setPanelMode("create");
    setSelectedTask(null);
    setForm(EMPTY_FORM);
    setMessage(null);
  }, []);

  const openEditPanel = useCallback((task: FixedPayTaskWithClaimer) => {
    setPanelMode("edit");
    setSelectedTask(task);
    setForm(taskToForm(task));
    setMessage(null);
  }, []);

  const closePanel = useCallback(() => {
    setPanelMode(null);
    setSelectedTask(null);
    setForm(EMPTY_FORM);
    setSaving(false);
    setPendingAttachment(null);
    setAttachmentMessage(null);
    setAttachments([]);
  }, []);

  const handleToggleActive = useCallback(
    async (task: FixedPayTaskWithClaimer) => {
      try {
        const res = await fetch(`/api/fixed-pay-tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: !task.is_active }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { task?: FixedPayTaskWithClaimer };
        if (data.task) {
          setTasks((current) => current.map((item) => (item.id === task.id ? data.task! : item)));
          if (selectedTask?.id === task.id) {
            setSelectedTask(data.task);
            setForm(taskToForm(data.task));
          }
        } else {
          await fetchTasks();
        }
      } catch (error) {
        setMessage({ type: "err", text: error instanceof Error ? error.message : "Unable to update task." });
      }
    },
    [fetchTasks, selectedTask?.id]
  );

  const handleSubmit = useCallback(async () => {
    if (!form.task_name.trim()) {
      setMessage({ type: "err", text: "Task name is required." });
      return;
    }

    const rate = Number(form.rate);
    if (!Number.isFinite(rate)) {
      setMessage({ type: "err", text: "Rate is required." });
      return;
    }

    if (!STATUS_OPTIONS.includes(form.status)) {
      setMessage({ type: "err", text: "Status is invalid." });
      return;
    }

    const isEdit = panelMode === "edit" && Boolean(selectedTask);
    const endpoint = isEdit && selectedTask ? `/api/fixed-pay-tasks/${selectedTask.id}` : "/api/fixed-pay-tasks";
    const method = isEdit ? "PATCH" : "POST";

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_name: form.task_name.trim(),
          account: form.account.trim() || null,
          category: form.category.trim() || null,
          rate,
          task_detail: form.task_detail.trim() || null,
          task_notes: form.task_notes.trim() || null,
          assigned_to: form.assigned_to || null,
          status: form.status,
          is_active: form.is_active,
        }),
      });

      if (!res.ok) {
        let errorText = `HTTP ${res.status}`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) errorText = data.error;
        } catch {
          // ignore parse failures
        }
        throw new Error(errorText);
      }

      const data = (await res.json()) as { task?: FixedPayTaskWithClaimer };
      const savedTask = data.task ?? null;

      await fetchTasks();
      if (savedTask) {
        setSelectedTask(savedTask);
        setPanelMode("edit");
        setForm(taskToForm(savedTask));
        setMessage({ type: "ok", text: isEdit ? "Task updated." : "Task created." });
      } else {
        setMessage({ type: "ok", text: isEdit ? "Task updated." : "Task created." });
      }
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Unable to save task." });
    } finally {
      setSaving(false);
    }
  }, [fetchTasks, form.account, form.assigned_to, form.category, form.is_active, form.rate, form.status, form.task_detail, form.task_name, form.task_notes, panelMode, selectedTask]);

  const handleAttachmentPick = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setPendingAttachment(event.target.files?.[0] ?? null);
    setAttachmentMessage(null);
  }, []);

  const handleUploadAttachment = useCallback(async () => {
    if (!selectedTask) return;
    if (!pendingAttachment) {
      setAttachmentMessage({ type: "err", text: "Choose a file first." });
      return;
    }

    setAttachmentUploading(true);
    setAttachmentMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", pendingAttachment);

      const res = await fetch(`/api/fixed-pay-tasks/${selectedTask.id}/attachments`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let errorText = `HTTP ${res.status}`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) errorText = data.error;
        } catch {
          // ignore parse failures
        }
        throw new Error(errorText);
      }

      await fetchAttachments(selectedTask.id);
      setPendingAttachment(null);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      setAttachmentMessage({ type: "ok", text: "Attachment uploaded." });
    } catch (error) {
      setAttachmentMessage({ type: "err", text: error instanceof Error ? error.message : "Unable to upload attachment." });
    } finally {
      setAttachmentUploading(false);
    }
  }, [fetchAttachments, pendingAttachment, selectedTask]);

  const panelTitle = panelMode === "edit" ? "Edit Task" : "New Task";
  const panelSubtitle = panelMode === "edit" && selectedTask ? `Editing #${selectedTask.id}` : "Create a task for the fixed-pay pool.";

  const currentAssignedProfile = selectedTask?.assigned_to_profile ?? null;
  const assignedToOptions = useMemo(() => mergeProfiles(vaOptions, currentAssignedProfile), [currentAssignedProfile, vaOptions]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="rounded-2xl border border-sand bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-parchment px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-bold text-espresso">Fixed Pay Tasks</h1>
            <p className="text-xs text-stone">Manage the fixed-pay task pool for per-task VAs.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-sand bg-parchment/40 p-1 text-xs font-semibold">
              {ACTIVE_FILTER_PILLS.map((pill) => (
                <button
                  key={pill.value}
                  type="button"
                  onClick={() => setActiveFilter(pill.value)}
                  className={`rounded-md px-3 py-1.5 transition-colors ${
                    activeFilter === pill.value ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={openCreatePanel}
              className="cursor-pointer rounded-lg border border-terracotta bg-terracotta px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#a85840]"
            >
              New Task
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          {!panelMode && message && (
            <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.type === "ok" ? "bg-sage-soft text-sage" : "bg-red-50 text-red-700"}`}>
              {message.text}
            </div>
          )}

          <div className="mb-3 flex items-center gap-2 text-[11px] text-stone">
            <span className="rounded-full bg-parchment px-2 py-0.5 font-semibold text-walnut">{filteredTasks.length}</span>
            <span>task{filteredTasks.length === 1 ? "" : "s"}</span>
            {activeFilter !== "all" && (
              <span className="rounded-full bg-slate-blue-soft px-2 py-0.5 font-semibold text-slate-blue">
                filtered by {activeFilter === "active" ? "Active" : "Inactive"}
              </span>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-parchment" />
              ))}
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-sand px-4 py-10 text-center text-sm text-stone">
              No fixed pay tasks found.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-sand bg-white shadow-sm">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-sand bg-parchment">
                    <th className="w-8 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut" />
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Task Name</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Account</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Category</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Status</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Rate</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Claimed By</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map((task) => {
                    const claimedBy = task.claimed_by_profile?.full_name || task.claimed_by_profile?.username || "—";
                    const isSelected = selectedTask?.id === task.id;

                    return (
                      <tr
                        key={task.id}
                        className={`cursor-pointer border-b border-sand last:border-0 transition-colors hover:bg-parchment/30 ${
                          isSelected ? "bg-parchment/50" : ""
                        }`}
                        onClick={() => openEditPanel(task)}
                      >
                        <td className="w-8 px-3 py-3" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => openEditPanel(task)}
                            className="flex h-6 w-6 items-center justify-center rounded text-stone transition-colors hover:bg-sand/50 hover:text-walnut"
                            aria-label={`Open ${task.task_name}`}
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M9 18l6-6-6-6" />
                            </svg>
                          </button>
                        </td>

                        <td className="px-3 py-3 text-[13px] font-medium text-walnut">{task.task_name}</td>
                        <td className="px-3 py-3 text-[13px] text-walnut">{task.account || <span className="text-stone/60">—</span>}</td>
                        <td className="px-3 py-3 text-[13px] text-walnut">{task.category || <span className="text-stone/60">—</span>}</td>
                        <td className="px-3 py-3 text-[13px] text-walnut">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASSES[task.status]}`}>
                            {STATUS_LABELS[task.status]}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-[13px] font-medium text-walnut">{formatRate(task.rate)}</td>
                        <td className="px-3 py-3 text-[13px] text-walnut">
                          <div className="space-y-0.5">
                            <div>{claimedBy}</div>
                            <div className="text-[10px] text-stone/70">{formatTimestamp(task.claimed_at)}</div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-[13px] text-walnut" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => void handleToggleActive(task)}
                            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                              task.is_active ? "bg-sage-soft text-sage hover:bg-sage/20" : "bg-parchment text-stone hover:bg-sand"
                            }`}
                          >
                            {task.is_active ? "On" : "Off"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {panelMode && (
        <div className="fixed inset-0 z-40 flex items-stretch">
          <div className="flex-1 bg-black/20" onClick={closePanel} />

          <div className="flex w-[520px] max-w-full flex-col overflow-hidden border-l border-sand bg-white shadow-2xl">
            <div className="shrink-0 flex items-center justify-between border-b border-sand px-5 py-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closePanel}
                  className="flex h-7 w-7 items-center justify-center rounded text-stone transition-colors hover:bg-sand/50 hover:text-espresso"
                  aria-label="Close task panel"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <div>
                  <span className="block text-[13px] font-semibold text-walnut">{panelTitle}</span>
                  <span className="block text-[11px] text-stone">{panelSubtitle}</span>
                </div>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Name</label>
                <input
                  value={form.task_name}
                  onChange={(event) => setForm((current) => ({ ...current, task_name: event.target.value }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  placeholder="Task name"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Account</label>
                <select
                  value={form.account}
                  onChange={(event) => setForm((current) => ({ ...current, account: event.target.value }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                >
                  <option value="">Select account...</option>
                  {accountOptions.map((account) => (
                    <option key={account} value={account}>
                      {account}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Category</label>
                <select
                  value={form.category}
                  onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                >
                  <option value="">Select category...</option>
                  {categoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Rate</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.rate}
                  onChange={(event) => setForm((current) => ({ ...current, rate: event.target.value }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Detail</label>
                <textarea
                  value={form.task_detail}
                  onChange={(event) => setForm((current) => ({ ...current, task_detail: event.target.value }))}
                  className="min-h-[96px] w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  placeholder="Task detail"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Notes</label>
                <textarea
                  value={form.task_notes}
                  onChange={(event) => setForm((current) => ({ ...current, task_notes: event.target.value }))}
                  className="min-h-[96px] w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  placeholder="Task notes"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Assign To</label>
                <select
                  value={form.assigned_to}
                  onChange={(event) => setForm((current) => ({ ...current, assigned_to: event.target.value }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                >
                  <option value="">Unassigned</option>
                  {assignedToOptions.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.full_name || profile.username || profile.id}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Status</label>
                <select
                  value={form.status}
                  onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as FixedPayTaskWithClaimer["status"] }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-stone">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
                  className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                />
                Active
              </label>

              <div className="rounded-xl border border-sand bg-parchment/20 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-stone">Attachments</div>
                    <div className="text-[11px] text-stone">Upload files to the task-attachments bucket.</div>
                  </div>
                  <span className="text-[11px] text-stone">{attachments.length} file{attachments.length === 1 ? "" : "s"}</span>
                </div>

                {attachmentMessage && (
                  <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${attachmentMessage.type === "ok" ? "bg-sage-soft text-sage" : "bg-red-50 text-red-700"}`}>
                    {attachmentMessage.text}
                  </div>
                )}

                {panelMode === "edit" && selectedTask ? (
                  <div className="space-y-3">
                    <input
                      ref={attachmentInputRef}
                      type="file"
                      onChange={handleAttachmentPick}
                      className="block w-full text-[13px] text-stone file:mr-3 file:rounded-lg file:border-0 file:bg-terracotta file:px-3 file:py-2 file:text-[12px] file:font-semibold file:text-white hover:file:bg-[#a85840]"
                    />

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleUploadAttachment()}
                        disabled={attachmentUploading || !pendingAttachment}
                        className="rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {attachmentUploading ? "Uploading..." : "Upload Attachment"}
                      </button>
                      {pendingAttachment && <span className="text-[11px] text-stone">{pendingAttachment.name}</span>}
                    </div>

                    {attachmentsLoading ? (
                      <div className="space-y-2">
                        {[1, 2].map((item) => (
                          <div key={item} className="h-12 animate-pulse rounded-lg bg-parchment" />
                        ))}
                      </div>
                    ) : attachments.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-sand px-3 py-4 text-[12px] text-stone">
                        No attachments yet.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {attachments.map((attachment) => (
                          <div key={attachment.id} className="rounded-lg border border-sand bg-white px-3 py-2 text-[12px] text-walnut">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate font-medium">{attachment.filename}</div>
                                <div className="text-[11px] text-stone">
                                  {formatAttachmentSize(attachment.file_size)}
                                  {attachment.file_size ? " · " : ""}
                                  {formatTimestamp(attachment.uploaded_at)}
                                </div>
                              </div>
                              <a
                                href={attachment.url ?? undefined}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 rounded-md border border-sand px-2 py-1 text-[11px] font-semibold text-stone transition-colors hover:border-terracotta hover:text-terracotta"
                              >
                                Open
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-sand px-3 py-4 text-[12px] text-stone">
                    Save the task first to upload attachments.
                  </div>
                )}
              </div>
            </div>

            <div className="shrink-0 border-t border-sand px-5 py-4">
              <div className={`mb-3 rounded-lg px-4 py-3 text-sm ${message?.type === "ok" ? "bg-sage-soft text-sage" : message?.type === "err" ? "bg-red-50 text-red-700" : "hidden"}`}>
                {message?.text}
              </div>

              <div className="flex items-center justify-end gap-3">
                <button type="button" onClick={closePanel} className="text-xs text-stone hover:text-espresso">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={saving}
                  className="rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving..." : panelMode === "edit" ? "Update Task" : "Create Task"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
