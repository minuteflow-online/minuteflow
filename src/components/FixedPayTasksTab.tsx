"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FixedPayTaskWithClaimer } from "@/types/database";

const EMPTY_FORM = {
  task_name: "",
  account: "",
  category: "",
  rate: "",
  is_active: true,
};

type TaskFormState = typeof EMPTY_FORM;
type PanelMode = "create" | "edit" | null;
type ActiveFilter = "all" | "active" | "inactive";

const FILTER_PILLS: Array<{ value: ActiveFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

function formatClaimedAt(claimedAt: string | null) {
  if (!claimedAt) return "—";
  const date = new Date(claimedAt);
  if (Number.isNaN(date.getTime())) return claimedAt;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRate(rate: number | string | null | undefined) {
  const parsed = typeof rate === "number" ? rate : Number(rate ?? NaN);
  if (Number.isNaN(parsed)) return "—";
  return `$${parsed.toFixed(2)}`;
}

export default function FixedPayTasksTab() {
  const [tasks, setTasks] = useState<FixedPayTaskWithClaimer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [selectedTask, setSelectedTask] = useState<FixedPayTaskWithClaimer | null>(null);
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const resetPanel = useCallback((task?: FixedPayTaskWithClaimer | null) => {
    if (task) {
      setPanelMode("edit");
      setSelectedTask(task);
      setForm({
        task_name: task.task_name,
        account: task.account ?? "",
        category: task.category ?? "",
        rate: String(task.rate ?? ""),
        is_active: task.is_active,
      });
      setMessage(null);
      return;
    }

    setPanelMode("create");
    setSelectedTask(null);
    setForm(EMPTY_FORM);
    setMessage(null);
  }, []);

  const closePanel = useCallback(() => {
    setPanelMode(null);
    setSelectedTask(null);
    setForm(EMPTY_FORM);
    setSaving(false);
    setMessage(null);
  }, []);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/fixed-pay-tasks", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rows = Array.isArray(json) ? json : json.tasks ?? [];
      setTasks(rows as FixedPayTaskWithClaimer[]);
    } catch {
      setTasks([]);
      setMessage({ type: "err", text: "Unable to load fixed pay tasks." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const filteredTasks = useMemo(() => {
    if (activeFilter === "all") return tasks;
    if (activeFilter === "active") return tasks.filter((task) => task.is_active);
    return tasks.filter((task) => !task.is_active);
  }, [activeFilter, tasks]);

  const handleSubmit = useCallback(async () => {
    if (!form.task_name.trim()) {
      setMessage({ type: "err", text: "Task name is required." });
      return;
    }
    if (!form.rate || Number.isNaN(Number(form.rate))) {
      setMessage({ type: "err", text: "Rate is required." });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        task_name: form.task_name.trim(),
        account: form.account.trim() || null,
        category: form.category.trim() || null,
        rate: Number(form.rate),
        is_active: form.is_active,
      };

      const res = await fetch(panelMode === "edit" && selectedTask ? `/api/fixed-pay-tasks/${selectedTask.id}` : "/api/fixed-pay-tasks", {
        method: panelMode === "edit" && selectedTask ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let messageText = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) messageText = data.error;
        } catch {
          // ignore parse failures
        }
        throw new Error(messageText);
      }

      await fetchTasks();
      closePanel();
      setMessage({ type: "ok", text: panelMode === "edit" ? "Task updated." : "Task created." });
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Unable to save task." });
    } finally {
      setSaving(false);
    }
  }, [closePanel, fetchTasks, form.account, form.category, form.is_active, form.rate, form.task_name, panelMode, selectedTask]);

  const handleToggle = useCallback(
    async (task: FixedPayTaskWithClaimer) => {
      setMessage(null);
      try {
        const res = await fetch(`/api/fixed-pay-tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: !task.is_active }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchTasks();
        if (selectedTask?.id === task.id) {
          setSelectedTask((current) =>
            current
              ? {
                  ...current,
                  is_active: !current.is_active,
                }
              : current
          );
          setForm((current) => ({ ...current, is_active: !task.is_active }));
        }
      } catch (err) {
        setMessage({ type: "err", text: err instanceof Error ? err.message : "Unable to update task." });
      }
    },
    [fetchTasks, selectedTask?.id]
  );

  const openCreatePanel = useCallback(() => {
    resetPanel(null);
  }, [resetPanel]);

  const openEditPanel = useCallback(
    (task: FixedPayTaskWithClaimer) => {
      resetPanel(task);
    },
    [resetPanel]
  );

  const panelTitle = panelMode === "edit" ? "Edit Task" : "New Task";
  const panelSubtitle = panelMode === "edit" && selectedTask ? `Editing #${selectedTask.id}` : "Create a task for the fixed-pay pool.";

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
              {FILTER_PILLS.map((pill) => (
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
          {message && (
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
                        className={`group cursor-pointer border-b border-sand last:border-0 transition-colors hover:bg-parchment/30 ${
                          isSelected ? "bg-parchment/50" : ""
                        }`}
                        onClick={() => openEditPanel(task)}
                      >
                        <td className="w-8 px-3 py-3" onClick={(e) => e.stopPropagation()}>
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

                        <td className="px-3 py-3 text-[13px]">
                          <span className="font-medium text-walnut">{task.task_name}</span>
                        </td>

                        <td className="px-3 py-3 text-[13px] text-walnut">{task.account || <span className="text-stone/60">—</span>}</td>

                        <td className="px-3 py-3 text-[13px] text-walnut">{task.category || <span className="text-stone/60">—</span>}</td>

                        <td className="px-3 py-3 text-[13px] font-medium text-walnut">{formatRate(task.rate)}</td>

                        <td className="px-3 py-3 text-[13px] text-walnut">
                          <div className="space-y-0.5">
                            <div>{claimedBy}</div>
                            <div className="text-[10px] text-stone/70">{formatClaimedAt(task.claimed_at)}</div>
                          </div>
                        </td>

                        <td className="px-3 py-3 text-[13px] text-walnut" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => void handleToggle(task)}
                            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                              task.is_active
                                ? "bg-sage-soft text-sage hover:bg-sage/20"
                                : "bg-parchment text-stone hover:bg-sand"
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
                <span className="text-[13px] font-semibold text-walnut">{panelTitle}</span>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Name</label>
                <input
                  value={form.task_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, task_name: e.target.value }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  placeholder="Task name"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Account</label>
                <input
                  value={form.account}
                  onChange={(e) => setForm((prev) => ({ ...prev, account: e.target.value }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  placeholder="Optional account"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Category</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  placeholder="Optional category"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Rate</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.rate}
                  onChange={(e) => setForm((prev) => ({ ...prev, rate: e.target.value }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  placeholder="0.00"
                />
              </div>

              <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-stone">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                />
                Active
              </label>

              <p className="text-[11px] text-stone">{panelSubtitle}</p>
            </div>

            {message && (
              <div className="px-5 pb-3">
                <div className={`rounded-lg px-4 py-3 text-sm ${message.type === "ok" ? "bg-sage-soft text-sage" : "bg-red-50 text-red-700"}`}>
                  {message.text}
                </div>
              </div>
            )}

            <div className="shrink-0 flex items-center justify-end gap-3 border-t border-sand px-5 py-4">
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
      )}
    </div>
  );
}
