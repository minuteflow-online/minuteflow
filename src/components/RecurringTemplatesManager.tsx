"use client";

import React, { useCallback, useMemo, useState } from "react";
import TaskEditor from "@/components/TaskEditor";
import type { Profile, RecurringTaskTemplate } from "@/types/database";

interface FormObjective {
  id: number;
  account: string | null;
  project_name: string;
}

interface FormTask {
  id: number;
  task_name: string;
}

interface RecurringTemplatesManagerProps {
  templates: RecurringTaskTemplate[];
  loading: boolean;
  activeProfiles: Pick<Profile, "id" | "full_name" | "username">[];
  profilesLoaded?: boolean;
  orgTimezone?: string;
  accountOptions: string[];
  projectTagsMap: Record<string, string[]>;
  formObjectives: FormObjective[];
  formTasksByObjective: Record<number, FormTask[]>;
  assignedByOptions: Pick<Profile, "id" | "full_name" | "username">[];
  onRefresh: () => void;
  vaMode?: boolean;
  currentUserId?: string;
}

type RecurrenceType = "daily" | "weekly" | "biweekly" | "monthly" | "every_2_months" | "every_3_months";

interface FormState {
  account: string;
  objective_id: string;
  objective_custom: string;
  task_name_mode: string;
  task_name_custom: string;
  category: string;
  start_date: string;
  assigned_by_id: string;
  task_detail: string;
  task_notes: string;
  instructions: string;
  instructions_locked: boolean;
  planned_duration: string;
  assigned_to_ids: string[];
  recurrence_type: RecurrenceType;
  is_active: boolean;
}

const RECURRENCE_OPTIONS: { value: RecurrenceType; label: string; helper: string }[] = [
  { value: "daily", label: "Daily", helper: "Repeats every day from the start date" },
  { value: "weekly", label: "Weekly", helper: "Repeats every week on the same day as the start date" },
  { value: "biweekly", label: "Every 2 weeks", helper: "Repeats every two weeks from the start date" },
  { value: "monthly", label: "Monthly", helper: "Repeats on the same date each month" },
  { value: "every_2_months", label: "Every 2 months", helper: "Repeats every two months on the same date" },
  { value: "every_3_months", label: "Every 3 months", helper: "Repeats every three months on the same date" },
];

function formatDate(iso: string | null | undefined, _tz?: string): string {
  if (!iso) return "—";
  try {
    // Parse the date portion directly to avoid UTC midnight → local day-behind bug
    const datePart = iso.slice(0, 10);
    const [year, month, day] = datePart.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function profileLabel(profile: Pick<Profile, "id" | "full_name" | "username">) {
  return profile.full_name || profile.username || profile.id;
}

function recurrenceLabel(template: RecurringTaskTemplate): string {
  switch (template.recurrence_type) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Every 2 weeks";
    case "monthly":
      return "Monthly";
    case "every_2_months":
      return "Every 2 months";
    case "every_3_months":
      return "Every 3 months";
    default:
      return template.recurrence_type;
  }
}


function templateAssignedToIds(template: RecurringTaskTemplate): string[] {
  const ids = template.assigned_to_ids?.filter(Boolean) ?? [];
  if (ids.length > 0) return ids;
  return template.assigned_to ? [template.assigned_to] : [];
}

function displayAssignedTo(
  template: RecurringTaskTemplate,
  activeProfiles: Pick<Profile, "id" | "full_name" | "username">[],
  profilesLoaded = true
): string {
  if (!profilesLoaded) return "—";
  const ids = templateAssignedToIds(template);
  if (ids.length === 0) return "—";
  const profileMap = new Map(activeProfiles.map((profile) => [profile.id, profile]));
  return ids
    .map((id) => profileLabel(profileMap.get(id) ?? { id, full_name: "", username: id }))
    .filter(Boolean)
    .join(", ");
}

function displayObjective(template: RecurringTaskTemplate) {
  return template.project || template.description || template.task_detail || "—";
}


export default function RecurringTemplatesManager({
  templates,
  loading,
  activeProfiles,
  profilesLoaded = true,
  orgTimezone,
  onRefresh,
  vaMode,
  currentUserId,
}: RecurringTemplatesManagerProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringTaskTemplate | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  // Repeat and Active are the only fields a template has that a task doesn't.
  // Everything else on this panel is TaskEditor's own state.
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>("daily");
  const [isActive, setIsActive] = useState(true);

  const assigneeOptions = useMemo(
    () => [...activeProfiles].sort((a, b) => profileLabel(a).localeCompare(profileLabel(b))),
    [activeProfiles]
  );

  const editorTeamMembers = useMemo(
    () => assigneeOptions.map((p) => ({ id: p.id, full_name: p.full_name, username: p.username })),
    [assigneeOptions]
  );

  // TaskEditor reads a task-shaped row, and a template is close enough to hand
  // it one directly — the column names line up on both sides.
  const templateAsInitialTask = useMemo(() => {
    if (!editingTemplate) return null;
    const row = editingTemplate as unknown as Record<string, unknown>;
    return {
      ...row,
      task_name: editingTemplate.title ?? editingTemplate.task_name ?? "",
      task_detail: editingTemplate.task_detail ?? editingTemplate.description ?? "",
      assigned_task_assignees: templateAssignedToIds(editingTemplate).map((va_id) => ({ va_id })),
    } as Record<string, unknown>;
  }, [editingTemplate]);

  const openCreate = useCallback(() => {
    setEditingTemplate(null);
    setRecurrenceType("daily");
    setIsActive(true);
    setNotice(null);
    setPanelOpen(true);
  }, []);

  const openEdit = useCallback((template: RecurringTaskTemplate) => {
    setEditingTemplate(template);
    setRecurrenceType(
      (["daily", "weekly", "biweekly", "monthly", "every_2_months", "every_3_months"] as const).includes(
        template.recurrence_type as RecurrenceType
      )
        ? (template.recurrence_type as RecurrenceType)
        : "daily"
    );
    setIsActive(template.is_active);
    setNotice(null);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setEditingTemplate(null);
    setNotice(null);
  }, []);
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
        <div className="rounded-xl border border-sand bg-white overflow-x-auto shadow-sm">
          <table className="min-w-full w-full">
            <thead>
              <tr className="bg-parchment border-b border-sand">
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Task Name</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Account</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Objective</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Detail</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Assigned To</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Status</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Start Date</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Repeat</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Created</th>
                <th className="px-3 py-2.5 w-40"></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const assignedTo = displayAssignedTo(template, activeProfiles, profilesLoaded);
                const statusClass = template.is_active ? "bg-sage-soft text-sage" : "bg-stone/10 text-stone";
                return (
                  <tr key={template.id} className="border-b border-sand last:border-0 hover:bg-parchment/30 transition-colors">
                    <td className="px-3 py-3 text-[13px] text-ink">
                      <button className="font-medium text-left hover:text-terracotta" onClick={() => openEdit(template)}>
                        {template.title || template.task_name || "Untitled template"}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-walnut">{template.account || "—"}</td>
                    <td className="px-3 py-3 text-[13px] text-walnut">{displayObjective(template)}</td>
                    <td className="px-3 py-3 text-[13px] text-walnut">
                      <span className="block max-w-[240px] truncate" title={template.task_detail ?? template.description ?? ""}>
                        {template.task_detail ?? template.description ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-walnut">
                      <span className="block max-w-[240px] truncate" title={assignedTo}>
                        {assignedTo}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass}`}>
                        {template.is_active ? "Active" : "Paused"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-walnut">{formatDate(template.start_date, orgTimezone)}</td>
                    <td className="px-3 py-3 text-[13px] text-walnut">{recurrenceLabel(template)}</td>
                    <td className="px-3 py-3 text-[13px] text-walnut">
                      <div className="space-y-0.5">
                        <div className="truncate max-w-[140px]">
                          {template.created_by_profile?.full_name || template.created_by_profile?.username || "—"}
                        </div>
                        <div className="text-[11px] text-stone/70">{formatDate(template.created_at, orgTimezone)}</div>
                      </div>
                    </td>
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

      {panelOpen && (
        <div className="fixed inset-0 z-50 bg-black/40">
          <div className="absolute inset-y-0 right-0 flex w-full justify-end">
            <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-sand px-6 py-4">
                <div>
                  <h2 className="text-sm font-bold text-espresso">
                    {editingTemplate ? "Edit recurring template" : "Create recurring template"}
                  </h2>
                  <p className="text-[11px] text-stone">The task form, plus how often it repeats.</p>
                </div>
                <button onClick={closePanel} className="text-stone hover:text-espresso cursor-pointer">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {/* The same TaskEditor every other surface uses. This panel used
                    to be a hand-written copy of it, which is why it kept falling
                    behind — Review Required, Link, calendar hours, the duration
                    field and the assignee picker all landed there and never
                    here. One form now, with Repeat/Active added on top. */}
                <TaskEditor
                  key={editingTemplate?.id ?? "new-template"}
                  mode="time_based"
                  templateMode
                  editingTemplateId={editingTemplate?.id ?? null}
                  initialTask={templateAsInitialTask}
                  currentUserId={currentUserId ?? ""}
                  isAdminOrManager={!vaMode}
                  teamMembers={editorTeamMembers}
                  templateExtra={{ recurrence_type: recurrenceType, is_active: isActive }}
                  onCancel={closePanel}
                  onSaved={() => {
                    onRefresh();
                    closePanel();
                  }}
                  recurrenceControl={
                    <div className="rounded-lg border border-sand bg-cream/40 p-3 space-y-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-amber">
                          Repeat
                        </label>
                        <select
                          value={recurrenceType}
                          onChange={(e) => setRecurrenceType(e.target.value as RecurrenceType)}
                          className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                        >
                          {RECURRENCE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-[11px] text-stone">
                          {RECURRENCE_OPTIONS.find((option) => option.value === recurrenceType)?.helper}
                        </p>
                      </div>
                      <label className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-walnut">
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={(e) => setIsActive(e.target.checked)}
                          className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                        />
                        Active
                      </label>
                    </div>
                  }
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
