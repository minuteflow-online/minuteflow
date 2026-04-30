"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TimeLog, Profile } from "@/types/database";

/* ── Constants ─────────────────────────────────────────── */

// Fallback only — DB fetch happens in the component

const CATEGORIES = [
  "Task",
  "Communication",
  "Planning",
  "Personal",
  "Break",
  "Collaboration",
];

const ACCOUNTS = [
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

/* ── Props ─────────────────────────────────────────────── */

interface EditTimeLogModalProps {
  log?: TimeLog | null; // null = create mode
  profiles: Profile[];
  currentUserId: string;
  currentUserRole?: string; // 'admin' | 'manager' | 'va'
  onClose: () => void;
  onSaved: () => void;
}

/* ── Helpers ───────────────────────────────────────────── */

function toLocalDatetimeValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalDatetimeValue(val: string): string {
  if (!val) return "";
  return new Date(val).toISOString();
}

/* ── Component ─────────────────────────────────────────── */

export default function EditTimeLogModal({
  log,
  profiles,
  currentUserId,
  currentUserRole,
  onClose,
  onSaved,
}: EditTimeLogModalProps) {
  const isCreate = !log;
  const isVA = currentUserRole === "va";
  const isAdminOrManager = currentUserRole === "admin" || currentUserRole === "manager";

  const [taskName, setTaskName] = useState(log?.task_name || "");
  const [category, setCategory] = useState(log?.category || "Task");
  const [account, setAccount] = useState(log?.account || "");
  const [clientName, setClientName] = useState(log?.client_name || "");
  const [project, setProject] = useState(log?.project || "");
  const [startTime, setStartTime] = useState(
    toLocalDatetimeValue(log?.start_time || null)
  );
  const [endTime, setEndTime] = useState(
    toLocalDatetimeValue(log?.end_time || null)
  );
  const [clientMemo, setClientMemo] = useState(log?.client_memo || "");
  const [internalMemo, setInternalMemo] = useState(log?.internal_memo || "");
  const [progress, setProgress] = useState(log?.progress || "");
  // VAs can only add time for themselves
  const [selectedUserId, setSelectedUserId] = useState(log?.user_id || (isVA ? currentUserId : ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dbAccounts, setDbAccounts] = useState<string[]>(ACCOUNTS);

  // Fetch accounts from DB
  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      if (res.ok) {
        const data = await res.json();
        const active = (data.accounts ?? [])
          .filter((a: { active: boolean }) => a.active)
          .map((a: { name: string }) => a.name);
        if (active.length > 0) setDbAccounts(active);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = async () => {
    if (!taskName.trim()) {
      setError("Task name is required");
      return;
    }
    if (!startTime) {
      setError("Start time is required");
      return;
    }
    if (isCreate && !selectedUserId) {
      setError("Please select a user");
      return;
    }

    setSaving(true);
    setError("");

    const supabase = createClient();
    const startIso = fromLocalDatetimeValue(startTime);
    const endIso = endTime ? fromLocalDatetimeValue(endTime) : null;

    // Guard: end_time must be after start_time
    if (endIso && new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      setError("End time must be after start time");
      setSaving(false);
      return;
    }

    const durationMs =
      endIso && startIso
        ? Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime())
        : 0;
    const isBillable = category !== "Personal";

    if (isCreate) {
      // Find the selected user's profile for denormalized fields
      const userProfile = profiles.find((p) => p.id === selectedUserId);
      if (!userProfile) {
        setError("Selected user not found");
        setSaving(false);
        return;
      }

      // VAs need approval for manual entries; admins/managers are auto-approved
      const isVaSubmission = currentUserRole === "va";
      const manualStatus = isVaSubmission ? "pending" : "approved";

      const { error: insertError } = await supabase.from("time_logs").insert({
        user_id: selectedUserId,
        username: userProfile.username,
        full_name: userProfile.full_name,
        department: userProfile.department,
        position: userProfile.position,
        task_name: taskName.trim(),
        category,
        project: project || null,
        account: account || null,
        client_name: clientName || null,
        start_time: startIso,
        end_time: endIso,
        duration_ms: durationMs,
        billable: isBillable,
        client_memo: clientMemo || null,
        internal_memo: internalMemo || null,
        is_manual: true,
        manual_status: manualStatus,
        session_date: startTime.slice(0, 10) || null,
      });

      if (insertError) {
        setError(insertError.message);
        setSaving(false);
        return;
      }

      // Audit record for manual creation
      // We don't have the new log_id easily here, so skip audit for create
    } else {
      // Edit mode -- track changes in audit table
      const changes: { field: string; oldVal: string | null; newVal: string | null }[] = [];

      if (taskName.trim() !== log.task_name)
        changes.push({ field: "task_name", oldVal: log.task_name, newVal: taskName.trim() });
      if (category !== log.category)
        changes.push({ field: "category", oldVal: log.category, newVal: category });
      if ((account || null) !== (log.account || null))
        changes.push({ field: "account", oldVal: log.account, newVal: account || null });
      if ((clientName || null) !== (log.client_name || null))
        changes.push({ field: "client_name", oldVal: log.client_name, newVal: clientName || null });
      if ((project || null) !== (log.project || null))
        changes.push({ field: "project", oldVal: log.project, newVal: project || null });

      const newStartIso = fromLocalDatetimeValue(startTime);
      if (newStartIso !== log.start_time)
        changes.push({ field: "start_time", oldVal: log.start_time, newVal: newStartIso });

      const newEndIso = endTime ? fromLocalDatetimeValue(endTime) : null;
      if ((newEndIso || null) !== (log.end_time || null))
        changes.push({ field: "end_time", oldVal: log.end_time, newVal: newEndIso });

      if ((clientMemo || null) !== (log.client_memo || null))
        changes.push({ field: "client_memo", oldVal: log.client_memo, newVal: clientMemo || null });
      if ((internalMemo || null) !== (log.internal_memo || null))
        changes.push({ field: "internal_memo", oldVal: log.internal_memo, newVal: internalMemo || null });
      if ((progress || null) !== (log.progress || null))
        changes.push({ field: "progress", oldVal: log.progress, newVal: progress || null });

      // Update the time_log
      const { error: updateError } = await supabase
        .from("time_logs")
        .update({
          task_name: taskName.trim(),
          category,
          account: account || null,
          client_name: clientName || null,
          project: project || null,
          start_time: startIso,
          end_time: endIso,
          duration_ms: durationMs,
          billable: isBillable,
          client_memo: clientMemo || null,
          internal_memo: internalMemo || null,
          progress: progress || null,
        })
        .eq("id", log.id);

      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }

      // Insert audit records
      if (changes.length > 0) {
        await supabase.from("time_log_edits").insert(
          changes.map((c) => ({
            log_id: log.id,
            edited_by: currentUserId,
            field_name: c.field,
            old_value: c.oldVal,
            new_value: c.newVal,
          }))
        );
      }

      // Auto-cascade: if end_time changed, update the next task's start_time to match
      if (newEndIso && newEndIso !== log.end_time) {
        const { data: nextTask } = await supabase
          .from("time_logs")
          .select("id, start_time, end_time, duration_ms")
          .eq("user_id", log.user_id)
          .gt("start_time", log.start_time)
          .is("deleted_at", null)
          .order("start_time", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (nextTask) {
          const newEndMs = new Date(newEndIso).getTime();
          const nextEndMs = nextTask.end_time ? new Date(nextTask.end_time).getTime() : null;
          // Only cascade if it won't shrink the next task to zero/negative duration
          if (!nextEndMs || newEndMs < nextEndMs) {
            await supabase
              .from("time_logs")
              .update({
                start_time: newEndIso,
                ...(nextEndMs ? { duration_ms: nextEndMs - newEndMs } : {}),
              })
              .eq("id", nextTask.id);
          }
        }
      }

      // Auto-cascade: if start_time changed, update the previous task's end_time to match
      if (newStartIso !== log.start_time) {
        const { data: prevTask } = await supabase
          .from("time_logs")
          .select("id, start_time, end_time, duration_ms")
          .eq("user_id", log.user_id)
          .lt("start_time", log.start_time)
          .is("deleted_at", null)
          .order("start_time", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (prevTask) {
          const newStartMs = new Date(newStartIso).getTime();
          const prevStartMs = new Date(prevTask.start_time).getTime();
          // Only cascade if it won't shrink the previous task to zero/negative duration
          if (newStartMs > prevStartMs) {
            await supabase
              .from("time_logs")
              .update({
                end_time: newStartIso,
                duration_ms: newStartMs - prevStartMs,
              })
              .eq("id", prevTask.id);
          }
        }
      }
    }

    setSaving(false);
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-sand bg-white shadow-xl mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
          <h2 className="text-sm font-bold text-espresso">
            {isCreate ? (isVA ? "Request Manual Time Entry" : "Add Manual Time Entry") : "Edit Time Entry"}
          </h2>
          <button
            onClick={onClose}
            className="text-stone hover:text-espresso transition-colors text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4">
          {/* Pending approval notice for VAs */}
          {isCreate && isVA && (
            <div className="rounded-lg bg-amber-soft px-3 py-2 text-xs text-amber font-medium">
              ⏳ Manual entries require admin approval before they count toward your logged time.
            </div>
          )}

          {/* User selector (create mode, admin/manager only — VAs auto-set to self) */}
          {isCreate && isAdminOrManager && (
            <div>
              <label className="block text-[11px] font-semibold text-bark mb-1">
                User
              </label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none transition-colors focus:border-terracotta"
              >
                <option value="">Select a user...</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} ({p.username})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Task Name */}
          <div>
            <label className="block text-[11px] font-semibold text-bark mb-1">
              Task Name
            </label>
            <input
              type="text"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none transition-colors focus:border-terracotta"
              placeholder="Task name..."
            />
          </div>

          {/* Category + Account row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-bark mb-1">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none transition-colors focus:border-terracotta"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-bark mb-1">
                Account
              </label>
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none transition-colors focus:border-terracotta"
              >
                <option value="">None</option>
                {dbAccounts.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Client + Project row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-bark mb-1">
                Client
              </label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none transition-colors focus:border-terracotta"
                placeholder="Client name..."
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-bark mb-1">
                Project
              </label>
              <input
                type="text"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none transition-colors focus:border-terracotta"
                placeholder="Project..."
              />
            </div>
          </div>

          {/* Start + End time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-bark mb-1">
                Start Time
              </label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none transition-colors focus:border-terracotta"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-bark mb-1">
                End Time
              </label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none transition-colors focus:border-terracotta"
              />
            </div>
          </div>

          {/* Memos */}
          <div>
            <label className="block text-[11px] font-semibold text-bark mb-1">
              Client Memo
            </label>
            <textarea
              value={clientMemo}
              onChange={(e) => setClientMemo(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none transition-colors focus:border-terracotta resize-none"
              placeholder="Visible to client..."
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-bark mb-1">
              Internal Memo
            </label>
            <textarea
              value={internalMemo}
              onChange={(e) => setInternalMemo(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none transition-colors focus:border-terracotta resize-none"
              placeholder="Internal notes..."
            />
          </div>

          {/* Progress Status */}
          <div>
            <label className="block text-[11px] font-semibold text-bark mb-1">
              Progress
            </label>
            <div className="flex gap-2">
              {[
                { value: "in_progress", label: "In Progress", color: "bg-terracotta text-white border-terracotta" },
                { value: "completed", label: "Completed", color: "bg-sage text-white border-sage" },
                { value: "on_hold", label: "On Hold", color: "bg-amber text-white border-amber" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setProgress(progress === opt.value ? "" : opt.value)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all border ${
                    progress === opt.value
                      ? opt.color
                      : "border-sand bg-white text-bark hover:border-terracotta"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-terracotta-soft px-3 py-2 text-xs text-terracotta">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-parchment px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-sand px-4 py-2 text-[13px] font-medium text-walnut transition-all hover:border-terracotta hover:text-terracotta"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50"
          >
            {saving ? "Saving..." : isCreate ? (isVA ? "Submit for Approval" : "Add Entry") : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
