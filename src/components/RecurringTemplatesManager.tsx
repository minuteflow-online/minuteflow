"use client";

import React, { useCallback, useMemo, useState } from "react";
import type { Profile, RecurringTaskTemplate } from "@/types/database";

interface RecurringTemplatesManagerProps {
  templates: RecurringTaskTemplate[];
  loading: boolean;
  activeProfiles: Profile[];
  orgTimezone?: string;
  onRefresh: () => void;
}

type RecurrenceType = "daily" | "weekly" | "monthly" | "custom";

interface FormState {
  title: string;
  description: string;
  assigned_to: string;
  account: string;
  project: string;
  category: string;
  pay_type: string;
  recurrence_type: RecurrenceType;
  recurrence_days: string;
  recurrence_day_of_month: string;
  is_active: boolean;
}

const RECURRENCE_OPTIONS: { value: RecurrenceType; label: string; helper: string }[] = [
  { value: "daily", label: "Daily", helper: "Creates a task every day" },
  { value: "weekly", label: "Weekly", helper: "Use the days field to pick weekdays" },
  { value: "monthly", label: "Monthly", helper: "Runs on the selected day of month" },
  { value: "custom", label: "Custom days", helper: "Use the days field to pick specific weekdays" },
];

function formatDate(iso: string, tz?: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(tz ? { timeZone: tz } : {}),
  });
}

function profileLabel(profile: Pick<Profile, "id" | "full_name" | "username">) {
  return profile.full_name || profile.username || profile.id;
}

function recurrenceLabel(template: RecurringTaskTemplate): string {
  const days = (template.recurrence_days ?? []).filter(Boolean);
  switch (template.recurrence_type) {
    case "daily":
      return "Daily";
    case "weekly":
      return days.length > 0 ? `Weekly (${days.join(", ")})` : "Weekly";
    case "monthly":
      return template.recurrence_day_of_month ? `Monthly (day ${template.recurrence_day_of_month})` : "Monthly";
    case "custom":
      return days.length > 0 ? `Custom (${days.join(", ")})` : "Custom";
    default:
      return template.recurrence_type;
  }
}

function defaultForm(): FormState {
  return {
    title: "",
    description: "",
    assigned_to: "",
    account: "",
    project: "",
    category: "",
    pay_type: "",
    recurrence_type: "daily",
    recurrence_days: "",
    recurrence_day_of_month: "",
    is_active: true,
  };
}

function templateToForm(template: RecurringTaskTemplate): FormState {
  return {
    title: template.title ?? "",
    description: template.description ?? "",
    assigned_to: template.assigned_to ?? "",
    account: template.account ?? "",
    project: template.project ?? "",
    category: template.category ?? "",
    pay_type: template.pay_type ?? "",
    recurrence_type: template.recurrence_type,
    recurrence_days: (template.recurrence_days ?? []).join(", "),
    recurrence_day_of_month: template.recurrence_day_of_month?.toString() ?? "",
    is_active: template.is_active,
  };
}

function parseDays(raw: string): string[] | null {
  const days = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return days.length > 0 ? days : null;
}

export default function RecurringTemplatesManager({
  templates,
  loading,
  activeProfiles,
  orgTimezone,
  onRefresh,
}: RecurringTemplatesManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringTaskTemplate | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const sortedProfiles = useMemo(
    () => [...activeProfiles].sort((a, b) => profileLabel(a).localeCompare(profileLabel(b))),
    [activeProfiles]
  );

  const openCreate = useCallback(() => {
    setEditingTemplate(null);
    setForm(defaultForm());
    setNotice(null);
    setIsOpen(true);
  }, []);

  const openEdit = useCallback((template: RecurringTaskTemplate) => {
    setEditingTemplate(template);
    setForm(templateToForm(template));
    setNotice(null);
    setIsOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsOpen(false);
    setEditingTemplate(null);
    setNotice(null);
  }, []);

  const saveTemplate = useCallback(async () => {
    if (!form.title.trim()) {
      setNotice({ type: "error", text: "Template title is required." });
      return;
    }
    if (!form.assigned_to) {
      setNotice({ type: "error", text: "Assigned To is required." });
      return;
    }
    if ((form.recurrence_type === "monthly") && !form.recurrence_day_of_month.trim()) {
      setNotice({ type: "error", text: "Monthly templates need a day of month." });
      return;
    }
    if ((form.recurrence_type === "weekly" || form.recurrence_type === "custom") && !form.recurrence_days.trim()) {
      setNotice({ type: "error", text: "Weekly/custom templates need at least one day." });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        assigned_to: form.assigned_to,
        account: form.account.trim() || null,
        project: form.project.trim() || null,
        category: form.category.trim() || null,
        pay_type: form.pay_type.trim() || null,
        recurrence_type: form.recurrence_type,
        recurrence_days: parseDays(form.recurrence_days),
        recurrence_day_of_month: form.recurrence_day_of_month.trim()
          ? Number(form.recurrence_day_of_month.trim())
          : null,
        is_active: form.is_active,
      };

      const res = await fetch(
        editingTemplate ? `/api/recurring-task-templates?id=${editingTemplate.id}` : "/api/recurring-task-templates",
        {
          method: editingTemplate ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editingTemplate ? { id: editingTemplate.id, ...payload } : payload),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setNotice({ type: "success", text: editingTemplate ? "Template updated." : "Template created." });
      onRefresh();
      setIsOpen(false);
      setEditingTemplate(null);
      setForm(defaultForm());
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Failed to save template." });
    } finally {
      setSaving(false);
    }
  }, [editingTemplate, form, onRefresh]);

  const toggleActive = useCallback(
    async (template: RecurringTaskTemplate) => {
      try {
        const res = await fetch(`/api/recurring-task-templates?id=${template.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: template.id, is_active: !template.is_active }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        onRefresh();
      } catch (error) {
        setNotice({ type: "error", text: error instanceof Error ? error.message : "Failed to update template." });
      }
    },
    [onRefresh]
  );

  const deleteTemplate = useCallback(
    async (template: RecurringTaskTemplate) => {
      if (!confirm(`Delete recurring template \"${template.title}\"? This removes the template but keeps created tasks.`)) return;
      try {
        const res = await fetch(`/api/recurring-task-templates?id=${template.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        onRefresh();
      } catch (error) {
        setNotice({ type: "error", text: error instanceof Error ? error.message : "Failed to delete template." });
      }
    },
    [onRefresh]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-walnut">Recurring templates</h3>
          <p className="text-xs text-stone">Templates stay out of the active task list and generate tasks on schedule.</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840]"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Template
        </button>
      </div>

      {notice && (
        <div className={`rounded-lg border px-3 py-2 text-[12px] ${notice.type === "success" ? "border-sage-soft bg-sage-soft text-sage" : "border-red-200 bg-red-50 text-red-600"}`}>
          {notice.text}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-sand bg-white p-5 shadow-sm text-center text-sm text-stone">
          Loading recurring templates...
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-sand bg-white p-8 shadow-sm text-center">
          <p className="text-sm font-medium text-espresso">No recurring templates yet</p>
          <p className="mt-1 text-xs text-stone">Create one to start auto-generating tasks on a schedule.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-sand bg-white overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="bg-parchment border-b border-sand">
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Title</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Assigned To</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Repeat</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Account</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Project</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Status</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Created</th>
                <th className="px-3 py-2.5 w-40"></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const assignedTo = template.assigned_to_profile ? profileLabel(template.assigned_to_profile) : template.assigned_to || "—";
                const createdLabel = formatDate(template.created_at, orgTimezone);
                return (
                  <tr key={template.id} className="border-b border-sand last:border-0 hover:bg-parchment/30 transition-colors">
                    <td className="px-3 py-3 text-[13px] text-ink">
                      <button className="font-medium text-left hover:text-terracotta" onClick={() => openEdit(template)}>
                        {template.title}
                      </button>
                      {template.description ? (
                        <p className="mt-1 max-w-[260px] truncate text-[11px] text-stone" title={template.description}>
                          {template.description}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-[13px] text-walnut">{assignedTo}</td>
                    <td className="px-3 py-3 text-[13px] text-walnut">{recurrenceLabel(template)}</td>
                    <td className="px-3 py-3 text-[13px] text-walnut">{template.account || "—"}</td>
                    <td className="px-3 py-3 text-[13px] text-walnut">{template.project || "—"}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${template.is_active ? "bg-sage-soft text-sage" : "bg-stone/10 text-stone"}`}>
                        {template.is_active ? "Active" : "Paused"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-walnut">{createdLabel}</td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(template)}
                          className="rounded-lg border border-sand px-3 py-1.5 text-[12px] text-walnut hover:border-walnut cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void toggleActive(template)}
                          className="rounded-lg border border-sand px-3 py-1.5 text-[12px] text-walnut hover:border-walnut cursor-pointer"
                        >
                          {template.is_active ? "Pause" : "Resume"}
                        </button>
                        <button
                          onClick={() => void deleteTemplate(template)}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-[12px] text-red-600 hover:border-red-400 cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-sand shrink-0">
              <h2 className="text-sm font-bold text-espresso">{editingTemplate ? "Edit recurring template" : "Create recurring template"}</h2>
              <button onClick={closeModal} className="text-stone hover:text-espresso cursor-pointer">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Title</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                  placeholder="Recurring task title"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  rows={4}
                  className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta resize-none"
                  placeholder="Optional details copied into generated tasks"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Assigned To</label>
                  <select
                    value={form.assigned_to}
                    onChange={(e) => setForm((prev) => ({ ...prev, assigned_to: e.target.value }))}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                  >
                    <option value="">Select member...</option>
                    {sortedProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profileLabel(profile)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Pay Type</label>
                  <input
                    value={form.pay_type}
                    onChange={(e) => setForm((prev) => ({ ...prev, pay_type: e.target.value }))}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                    placeholder="Hourly, fixed, per-task, etc."
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Account</label>
                  <input
                    value={form.account}
                    onChange={(e) => setForm((prev) => ({ ...prev, account: e.target.value }))}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                    placeholder="Optional account"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Project</label>
                  <input
                    value={form.project}
                    onChange={(e) => setForm((prev) => ({ ...prev, project: e.target.value }))}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                    placeholder="Optional project"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Category</label>
                  <input
                    value={form.category}
                    onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                    placeholder="Optional category"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Repeat</label>
                  <select
                    value={form.recurrence_type}
                    onChange={(e) => setForm((prev) => ({ ...prev, recurrence_type: e.target.value as RecurrenceType }))}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                  >
                    {RECURRENCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-stone">{RECURRENCE_OPTIONS.find((option) => option.value === form.recurrence_type)?.helper}</p>
                </div>
              </div>

              {(form.recurrence_type === "weekly" || form.recurrence_type === "custom") && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Days</label>
                  <input
                    value={form.recurrence_days}
                    onChange={(e) => setForm((prev) => ({ ...prev, recurrence_days: e.target.value }))}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                    placeholder="Monday, Wednesday, Friday"
                  />
                  <p className="mt-1 text-[11px] text-stone">Comma-separated weekday names or numbers accepted.</p>
                </div>
              )}

              {form.recurrence_type === "monthly" && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Day of month</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={form.recurrence_day_of_month}
                    onChange={(e) => setForm((prev) => ({ ...prev, recurrence_day_of_month: e.target.value }))}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                    placeholder="e.g. 15"
                  />
                </div>
              )}

              <label className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-walnut">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                />
                Active
              </label>
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-sand shrink-0">
              <button onClick={closeModal} className="text-xs text-stone hover:text-espresso cursor-pointer">
                Cancel
              </button>
              <div className="flex flex-col items-end gap-2">
                {notice && (
                  <p className={`text-xs font-medium ${notice.type === "success" ? "text-sage" : "text-red-500"}`}>
                    {notice.text}
                  </p>
                )}
                <button
                  onClick={() => void saveTemplate()}
                  disabled={saving}
                  className="rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? "Saving..." : editingTemplate ? "Save Changes" : "Create Template"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
