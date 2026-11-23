"use client";

import { useEffect, useState } from "react";

interface VaOption {
  id: string;
  full_name: string;
}

const CATEGORIES = ["Task", "Communication", "Planning", "Collaboration"];

export default function ClientAssignTaskPanel({ onAssigned }: { onAssigned?: () => void }) {
  const [vas, setVas] = useState<VaOption[]>([]);
  const [open, setOpen] = useState(false);
  const [vaId, setVaId] = useState("");
  const [taskName, setTaskName] = useState("");
  const [taskDetail, setTaskDetail] = useState("");
  const [category, setCategory] = useState("Task");
  const [dueDate, setDueDate] = useState("");
  // Time-based tasks need a planned duration (or a time slot) — without one
  // the VA's own task editor refuses to save any change to the task.
  const [plannedHours, setPlannedHours] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/organization-invites")
      .then((r) => r.json())
      .then((data) => {
        interface MemberRow {
          status: "invited" | "active";
          va_id: string;
          profiles: { full_name: string } | null;
        }
        const active: VaOption[] = ((data.members ?? []) as MemberRow[])
          .filter((m) => m.status === "active")
          .map((m) => ({ id: m.va_id, full_name: m.profiles?.full_name ?? "Unknown" }));
        setVas(active);
        setVaId((current) => current || active[0]?.id || "");
      })
      .catch(() => {});
  }, []);

  const reset = () => {
    setTaskName("");
    setTaskDetail("");
    setCategory("Task");
    setDueDate("");
    setPlannedHours("1");
    setError("");
  };

  const handleAssign = async () => {
    if (!vaId || !taskName.trim()) {
      setError("Pick a VA and enter a task name.");
      return;
    }
    const hours = Number(plannedHours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      setError("Enter the planned time in hours (for example 1 or 1.5).");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/assigned-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        va_ids: [vaId],
        task_name: taskName.trim(),
        task_detail: taskDetail.trim() || null,
        category,
        due_date: dueDate || null,
        // Starts today; the planned time is what puts it on the VA's
        // schedule, same as a duration-only task from staff.
        start_date: new Date().toLocaleDateString("en-CA"),
        planned_minutes: Math.round(hours * 60),
        review_required: true,
        // A client names the VA directly — it's a firm assignment, not an
        // open-pool offer, so it lands straight in their Assigned Tasks
        // rather than the claimable pool "pending" would put it in.
        initial_status: "on_queue",
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Couldn't assign the task.");
      return;
    }
    reset();
    setOpen(false);
    onAssigned?.();
  };

  if (vas.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4">
        <p className="text-sm font-medium text-espresso">No VAs yet</p>
        <p className="mt-1 text-xs text-stone">Invite a VA from Your Team before assigning tasks.</p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors"
      >
        + Assign a Task
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Assign a Task</h3>
        <button onClick={() => setOpen(false)} className="text-bark hover:text-terracotta text-lg leading-none cursor-pointer">&times;</button>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-walnut mb-1">Assign to</label>
        <select
          value={vaId}
          onChange={(e) => setVaId(e.target.value)}
          className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
        >
          {vas.map((v) => (
            <option key={v.id} value={v.id}>{v.full_name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-walnut mb-1">Task</label>
        <input
          type="text"
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          placeholder="What needs to be done?"
          className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
        />
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-walnut mb-1">Details (optional)</label>
        <textarea
          value={taskDetail}
          onChange={(e) => setTaskDetail(e.target.value)}
          rows={3}
          placeholder="Instructions, links, anything your VA needs..."
          className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white resize-none"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1">Due date (optional)</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1">Planned time (hours)</label>
          <input
            type="number"
            min="0.25"
            max="24"
            step="0.25"
            value={plannedHours}
            onChange={(e) => setPlannedHours(e.target.value)}
            className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
          />
        </div>
      </div>

      {error && <p className="text-xs text-terracotta">{error}</p>}

      <button
        onClick={handleAssign}
        disabled={saving}
        className="w-full py-2 rounded-lg bg-sage text-white text-[12px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
      >
        {saving ? "Assigning..." : "Assign Task"}
      </button>
    </div>
  );
}
