"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TimeLog } from "@/types/database";

const CORRECTABLE_FIELDS = [
  { key: "task_name", label: "Task Name" },
  { key: "category", label: "Category" },
  { key: "account", label: "Account" },
  { key: "client_name", label: "Client" },
  { key: "project", label: "Project" },
  { key: "start_time", label: "Start Time" },
  { key: "end_time", label: "End Time" },
  { key: "client_memo", label: "Client Memo" },
  { key: "internal_memo", label: "Internal Memo" },
];

const CATEGORIES = [
  "Task",
  "Communication",
  "Planning",
  "Personal",
  "Break",
  "Collaboration",
];

interface ProjectTag {
  id: number;
  account: string | null;
  project_name: string;
}

interface TaskOption {
  id: number;
  task_name: string;
}

interface CorrectionRequestModalProps {
  log: TimeLog;
  currentUserId: string;
  timezone?: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export default function CorrectionRequestModal({
  log,
  currentUserId,
  timezone = "UTC",
  onClose,
  onSubmitted,
}: CorrectionRequestModalProps) {
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ── Cascading data for smart dropdowns
  const [dbAccounts, setDbAccounts] = useState<string[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectTag[]>([]);
  const [allClientNames, setAllClientNames] = useState<string[]>([]);
  const [accountClientMap, setAccountClientMap] = useState<Record<string, string>>({});
  const [tasksByProject, setTasksByProject] = useState<Record<number, TaskOption[]>>({});

  const fetchFormData = useCallback(async () => {
    try {
      const [accRes, optRes, clientRes] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/task-form-options"),
        fetch("/api/clients"),
      ]);

      let accountList: { id: number; name: string; active: boolean }[] = [];
      let clientList: { id: number; name: string; active: boolean }[] = [];

      if (accRes.ok) {
        const data = await accRes.json();
        accountList = data.accounts ?? [];
        const active = accountList
          .filter((a) => a.active)
          .map((a) => a.name);
        setDbAccounts(active);
      }
      if (optRes.ok) {
        const data = await optRes.json();
        if (data.projects?.length > 0) setAllProjects(data.projects);
        if (data.tasksByProject) setTasksByProject(data.tasksByProject);
      }
      if (clientRes.ok) {
        const data = await clientRes.json();
        clientList = data.clients ?? [];
        const names: string[] = clientList
          .filter((c) => c.active !== false)
          .map((c) => c.name)
          .sort();
        setAllClientNames(names);
      }

      // Build account→client map
      if (accountList.length > 0 && clientList.length > 0) {
        const supabase = createClient();
        const { data: mappings } = await supabase
          .from("account_client_map")
          .select("account_id, client_id");
        if (mappings) {
          const map: Record<string, string> = {};
          for (const m of mappings) {
            const account = accountList.find((a) => a.id === m.account_id);
            const client = clientList.find((c) => c.id === m.client_id);
            if (account && client) {
              map[account.name] = client.name;
            }
          }
          setAccountClientMap(map);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchFormData();
  }, [fetchFormData]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleField = (key: string) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        setFieldValues((fv) => {
          const copy = { ...fv };
          delete copy[key];
          return copy;
        });
      } else {
        next.add(key);
        const currentVal = (log as unknown as Record<string, unknown>)[key];
        setFieldValues((fv) => ({
          ...fv,
          [key]: currentVal != null ? String(currentVal) : "",
        }));
      }
      return next;
    });
  };

  const setFieldVal = (key: string, val: string) => {
    setFieldValues((fv) => ({ ...fv, [key]: val }));
  };

  // Derive the corrected account value (if that field is also selected)
  const correctedAccount = selectedFields.has("account")
    ? (fieldValues["account"] || "")
    : (log.account || "");

  // Derive the corrected project value (if that field is also selected)
  const correctedProject = selectedFields.has("project")
    ? (fieldValues["project"] || "")
    : (log.project || "");

  // Projects filtered by account
  const filteredProjects = allProjects.filter((p) => p.account === correctedAccount);

  // Tasks filtered by selected project
  const selectedProjectTag = allProjects.find((p) => p.project_name === correctedProject);
  const filteredTasks: TaskOption[] = selectedProjectTag
    ? (tasksByProject[selectedProjectTag.id] ?? [])
    : [];

  const handleSubmit = async () => {
    if (selectedFields.size === 0) {
      setError("Select at least one field to correct");
      return;
    }
    if (!reason.trim()) {
      setError("Please provide a reason for the correction");
      return;
    }

    // Validate time fields: end_time must be after start_time
    if (selectedFields.has("start_time") || selectedFields.has("end_time")) {
      const effectiveStart = selectedFields.has("start_time")
        ? fieldValues["start_time"]
        : log.start_time;
      const effectiveEnd = selectedFields.has("end_time")
        ? fieldValues["end_time"]
        : log.end_time;
      if (effectiveStart && effectiveEnd) {
        if (new Date(effectiveEnd).getTime() <= new Date(effectiveStart).getTime()) {
          setError("The end time must be after the start time. Please fix your correction before submitting.");
          return;
        }
      }
    }

    setSaving(true);
    setError("");

    const requestedChanges: Record<string, string> = {};
    selectedFields.forEach((key) => {
      requestedChanges[key] = fieldValues[key] || "";
    });

    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("time_correction_requests")
      .insert({
        log_id: log.id,
        requested_by: currentUserId,
        reason: reason.trim(),
        requested_changes: requestedChanges,
        status: "pending",
      });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    onSubmitted();
  };

  // Render the appropriate input for each field when selected
  const renderFieldInput = (fieldKey: string) => {
    const val = fieldValues[fieldKey] || "";

    if (fieldKey === "account") {
      return (
        <select
          value={val}
          onChange={(e) => {
            const newAccount = e.target.value;
            setFieldVal(fieldKey, newAccount);
            // Auto-populate client when account is selected
            const mappedClient = newAccount ? accountClientMap[newAccount] : "";
            if (mappedClient) {
              // Add client_name to selected fields and set its value
              setSelectedFields((prev) => {
                const next = new Set(prev);
                next.add("client_name");
                return next;
              });
              setFieldValues((fv) => ({ ...fv, client_name: mappedClient }));
            }
          }}
          className="mt-1 w-full rounded border border-sand px-2 py-1.5 text-xs text-espresso outline-none focus:border-terracotta"
        >
          <option value="">Select account...</option>
          {dbAccounts.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      );
    }

    if (fieldKey === "client_name") {
      return (
        <select
          value={val}
          onChange={(e) => setFieldVal(fieldKey, e.target.value)}
          className="mt-1 w-full rounded border border-sand px-2 py-1.5 text-xs text-espresso outline-none focus:border-terracotta"
        >
          <option value="">No client</option>
          {allClientNames.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
          <option value="__other__">Other (type below)...</option>
          {val && !allClientNames.includes(val) && val !== "__other__" && (
            <option value={val}>{val}</option>
          )}
        </select>
      );
    }

    if (fieldKey === "project") {
      return (
        <div className="space-y-1">
          <select
            value={filteredProjects.find((p) => p.project_name === val) ? val : (val ? "__other__" : "")}
            onChange={(e) => {
              if (e.target.value === "__other__") {
                setFieldVal(fieldKey, "");
              } else {
                setFieldVal(fieldKey, e.target.value);
              }
            }}
            className="mt-1 w-full rounded border border-sand px-2 py-1.5 text-xs text-espresso outline-none focus:border-terracotta"
          >
            <option value="">
              {!correctedAccount ? "Select account first..." : "Select project..."}
            </option>
            {filteredProjects.map((p) => (
              <option key={p.id} value={p.project_name}>{p.project_name}</option>
            ))}
            <option value="__other__">✏️ Custom name...</option>
          </select>
          {/* Show text input when "Custom name..." is selected or when value doesn't match any project */}
          {val && !filteredProjects.find((p) => p.project_name === val) && (
            <input
              type="text"
              value={val === "__other__" ? "" : val}
              onChange={(e) => setFieldVal(fieldKey, e.target.value)}
              placeholder="Type project name..."
              className="w-full rounded border border-sand px-2 py-1 text-xs text-espresso outline-none focus:border-terracotta"
            />
          )}
        </div>
      );
    }

    if (fieldKey === "category") {
      return (
        <select
          value={val}
          onChange={(e) => setFieldVal(fieldKey, e.target.value)}
          className="mt-1 w-full rounded border border-sand px-2 py-1.5 text-xs text-espresso outline-none focus:border-terracotta"
        >
          <option value="">Select category...</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      );
    }

    if (fieldKey === "task_name") {
      if (filteredTasks.length > 0) {
        return (
          <div className="space-y-1">
            <select
              value={filteredTasks.find((t) => t.task_name === val) ? val : (val ? "__other__" : "")}
              onChange={(e) => {
                if (e.target.value === "__other__") {
                  setFieldVal(fieldKey, "");
                } else {
                  setFieldVal(fieldKey, e.target.value);
                }
              }}
              className="mt-1 w-full rounded border border-sand px-2 py-1.5 text-xs text-espresso outline-none focus:border-terracotta"
            >
              <option value="">
                {!correctedProject ? "Select project first..." : "Select task..."}
              </option>
              {filteredTasks.map((t) => (
                <option key={t.id} value={t.task_name}>{t.task_name}</option>
              ))}
              <option value="__other__">✏️ Custom name...</option>
            </select>
            {val && !filteredTasks.find((t) => t.task_name === val) && (
              <input
                type="text"
                value={val === "__other__" ? "" : val}
                onChange={(e) => setFieldVal(fieldKey, e.target.value)}
                placeholder="Type task name..."
                className="w-full rounded border border-sand px-2 py-1 text-xs text-espresso outline-none focus:border-terracotta"
              />
            )}
          </div>
        );
      }
      // Fall through to free-text if no tasks configured for the project
    }

    if (fieldKey.includes("time")) {
      // Inline time conflict warning
      let timeWarning = "";
      if (fieldKey === "end_time" && val) {
        const effectiveStart = selectedFields.has("start_time")
          ? fieldValues["start_time"]
          : log.start_time;
        if (effectiveStart && new Date(val).getTime() <= new Date(effectiveStart).getTime()) {
          timeWarning = "⚠️ End time must be after the start time.";
        }
      }
      if (fieldKey === "start_time" && val) {
        const effectiveEnd = selectedFields.has("end_time")
          ? fieldValues["end_time"]
          : log.end_time;
        if (effectiveEnd && new Date(val).getTime() >= new Date(effectiveEnd).getTime()) {
          timeWarning = "⚠️ Start time must be before the end time.";
        }
      }
      return (
        <div>
          <input
            type="datetime-local"
            value={val}
            onChange={(e) => setFieldVal(fieldKey, e.target.value)}
            className="mt-1 w-full rounded border border-sand px-2 py-1 text-xs text-espresso outline-none focus:border-terracotta"
          />
          {timeWarning && (
            <p className="mt-1 text-[11px] text-terracotta font-medium">{timeWarning}</p>
          )}
        </div>
      );
    }

    // Default: free-text input
    return (
      <input
        type="text"
        value={val}
        onChange={(e) => setFieldVal(fieldKey, e.target.value)}
        placeholder={`Correct to...`}
        className="mt-1 w-full rounded border border-sand px-2 py-1 text-xs text-espresso outline-none focus:border-terracotta"
      />
    );
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-sand bg-white shadow-xl mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
          <h2 className="text-sm font-bold text-espresso">
            Request Correction
          </h2>
          <button
            onClick={onClose}
            className="text-stone hover:text-espresso transition-colors text-lg leading-none"
          >
            &times;
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Full original entry info */}
          <div className="rounded-lg bg-parchment px-3 py-3 space-y-1.5">
            <div className="text-xs font-bold text-espresso">{log.task_name}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <div><span className="text-bark">Category:</span> <span className="text-espresso font-medium">{log.category}</span></div>
              <div><span className="text-bark">Account:</span> <span className="text-espresso font-medium">{log.account || "—"}</span></div>
              <div><span className="text-bark">Client:</span> <span className="text-espresso font-medium">{log.client_name || "—"}</span></div>
              <div><span className="text-bark">Project:</span> <span className="text-espresso font-medium">{log.project || "—"}</span></div>
              <div><span className="text-bark">Start:</span> <span className="text-espresso font-medium">{new Date(log.start_time).toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}</span></div>
              <div><span className="text-bark">End:</span> <span className="text-espresso font-medium">{log.end_time ? new Date(log.end_time).toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "Running"}</span></div>
              <div><span className="text-bark">Duration:</span> <span className="text-espresso font-medium">{log.duration_ms > 0 ? `${Math.floor(log.duration_ms / 60000)}m` : "—"}</span></div>
              <div><span className="text-bark">Billable:</span> <span className="text-espresso font-medium">{log.billable ? "Yes" : "No"}</span></div>
            </div>
            {log.client_memo && (
              <div className="text-[11px]"><span className="text-bark">Client Memo:</span> <span className="text-espresso">{log.client_memo}</span></div>
            )}
            {log.internal_memo && (
              <div className="text-[11px]"><span className="text-bark">Internal Memo:</span> <span className="text-espresso">{log.internal_memo}</span></div>
            )}
          </div>

          {/* Field checkboxes */}
          <div>
            <label className="block text-[11px] font-semibold text-bark mb-2">
              What needs to be corrected?
            </label>
            <div className="space-y-2">
              {CORRECTABLE_FIELDS.map((field) => (
                <label
                  key={field.key}
                  className="flex items-start gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedFields.has(field.key)}
                    onChange={() => toggleField(field.key)}
                    className="mt-0.5 accent-terracotta"
                  />
                  <div className="flex-1">
                    <span className="text-xs font-medium text-espresso">
                      {field.label}
                    </span>
                    {selectedFields.has(field.key) && renderFieldInput(field.key)}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-[11px] font-semibold text-bark mb-1">
              Reason for correction
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none transition-colors focus:border-terracotta resize-none"
              placeholder="Explain what needs to be corrected and why..."
            />
          </div>

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
            onClick={handleSubmit}
            disabled={saving}
            className="rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50"
          >
            {saving ? "Submitting..." : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}
