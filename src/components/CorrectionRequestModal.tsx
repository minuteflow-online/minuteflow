"use client";

import { useState, useEffect } from "react";
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
        // Remove the field value too
        setFieldValues((fv) => {
          const copy = { ...fv };
          delete copy[key];
          return copy;
        });
      } else {
        next.add(key);
        // Pre-populate with current value
        const currentVal = (log as unknown as Record<string, unknown>)[key];
        setFieldValues((fv) => ({
          ...fv,
          [key]: currentVal != null ? String(currentVal) : "",
        }));
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selectedFields.size === 0) {
      setError("Select at least one field to correct");
      return;
    }
    if (!reason.trim()) {
      setError("Please provide a reason for the correction");
      return;
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
                    {selectedFields.has(field.key) && (
                      <input
                        type={
                          field.key.includes("time")
                            ? "datetime-local"
                            : "text"
                        }
                        value={fieldValues[field.key] || ""}
                        onChange={(e) =>
                          setFieldValues((fv) => ({
                            ...fv,
                            [field.key]: e.target.value,
                          }))
                        }
                        placeholder={`Correct ${field.label.toLowerCase()} to...`}
                        className="mt-1 w-full rounded border border-sand px-2 py-1 text-xs text-espresso outline-none focus:border-terracotta"
                      />
                    )}
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
