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

export default function FixedPayTasksTab() {
  const [tasks, setTasks] = useState<FixedPayTaskWithClaimer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTask, setActiveTask] = useState<FixedPayTaskWithClaimer | null>(null);
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const resetForm = useCallback((task?: FixedPayTaskWithClaimer | null) => {
    if (task) {
      setForm({
        task_name: task.task_name,
        account: task.account ?? "",
        category: task.category ?? "",
        rate: String(task.rate ?? ""),
        is_active: task.is_active,
      });
      setActiveTask(task);
      setMessage(null);
      return;
    }
    setForm(EMPTY_FORM);
    setActiveTask(null);
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

      const res = await fetch(activeTask ? `/api/fixed-pay-tasks/${activeTask.id}` : "/api/fixed-pay-tasks", {
        method: activeTask ? "PATCH" : "POST",
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
      resetForm();
      setMessage({ type: "ok", text: activeTask ? "Task updated." : "Task created." });
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Unable to save task." });
    } finally {
      setSaving(false);
    }
  }, [activeTask, fetchTasks, form.account, form.category, form.is_active, form.rate, form.task_name, resetForm]);

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
      } catch (err) {
        setMessage({ type: "err", text: err instanceof Error ? err.message : "Unable to update task." });
      }
    },
    [fetchTasks]
  );

  const rows = useMemo(() => tasks, [tasks]);

  return (
    <div className="rounded-xl border border-sand bg-white">
      <div className="border-b border-parchment px-5 py-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-espresso">Fixed Pay Tasks</h2>
          <p className="text-[11px] text-stone mt-0.5">Manage the fixed-pay task pool for per-task VAs.</p>
        </div>
        <button
          type="button"
          onClick={() => resetForm()}
          className="rounded-lg bg-terracotta px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#c4573a] transition-colors"
        >
          New Task
        </button>
      </div>

      <div className="p-5 space-y-4">
        {message && (
          <div className={`rounded-lg px-4 py-3 text-sm ${message.type === "ok" ? "bg-sage-soft text-sage" : "bg-red-50 text-red-700"}`}>
            {message.text}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="overflow-hidden rounded-xl border border-sand bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand bg-parchment/70 text-left text-[11px] uppercase tracking-wider text-walnut">
                  <th className="px-3 py-2">Task</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Rate</th>
                  <th className="px-3 py-2">Claimed By</th>
                  <th className="px-3 py-2">Active</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-stone" colSpan={7}>
                      Loading...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-stone" colSpan={7}>
                      No fixed pay tasks yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((task) => (
                    <tr key={task.id} className="border-b border-parchment last:border-b-0">
                      <td className="px-3 py-3 text-espresso font-medium">{task.task_name}</td>
                      <td className="px-3 py-3 text-stone">{task.account || "—"}</td>
                      <td className="px-3 py-3 text-stone">{task.category || "—"}</td>
                      <td className="px-3 py-3 text-stone">${Number(task.rate).toFixed(2)}</td>
                      <td className="px-3 py-3 text-stone">
                        <div className="space-y-0.5">
                          <div>{task.claimed_by_profile?.full_name || task.claimed_by_profile?.username || "—"}</div>
                          <div className="text-[10px] text-stone/70">{formatClaimedAt(task.claimed_at)}</div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-stone">
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
                      <td className="px-3 py-3 text-stone">
                        <button
                          type="button"
                          onClick={() => resetForm(task)}
                          className="text-[11px] font-semibold text-terracotta hover:underline"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-sand bg-parchment/20 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-espresso">{activeTask ? "Edit Task" : "New Task"}</h3>
              <p className="text-[11px] text-stone mt-0.5">{activeTask ? `Editing #${activeTask.id}` : "Create a task for the pool."}</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Name</label>
                <input
                  value={form.task_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, task_name: e.target.value }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-espresso outline-none focus:border-terracotta"
                  placeholder="Task name"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Account</label>
                <input
                  value={form.account}
                  onChange={(e) => setForm((prev) => ({ ...prev, account: e.target.value }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-espresso outline-none focus:border-terracotta"
                  placeholder="Optional account"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Category</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-espresso outline-none focus:border-terracotta"
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
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-espresso outline-none focus:border-terracotta"
                  placeholder="0.00"
                />
              </div>

              <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-stone">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                />
                Active
              </label>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={saving}
                  className="rounded-lg bg-sage px-4 py-2 text-[11px] font-semibold text-white hover:bg-sage/80 disabled:opacity-60 transition-colors"
                >
                  {saving ? "Saving..." : activeTask ? "Update Task" : "Create Task"}
                </button>
                {activeTask && (
                  <button
                    type="button"
                    onClick={() => resetForm()}
                    className="rounded-lg bg-parchment px-4 py-2 text-[11px] font-semibold text-stone hover:bg-sand transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
