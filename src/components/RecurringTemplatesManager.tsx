"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

interface AttachmentRow {
  id: number;
  filename: string;
  storage_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  url: string | null;
}

interface RecurringTemplatesManagerProps {
  templates: RecurringTaskTemplate[];
  loading: boolean;
  activeProfiles: Profile[];
  orgTimezone?: string;
  accountOptions: string[];
  projectTagsMap: Record<string, string[]>;
  formObjectives: FormObjective[];
  formTasksByObjective: Record<number, FormTask[]>;
  assignedByOptions: Pick<Profile, "id" | "full_name" | "username">[];
  onRefresh: () => void;
}

type RecurrenceType = "daily" | "weekly" | "monthly" | "custom";

interface FormState {
  account: string;
  objective_id: string;
  objective_custom: string;
  task_name_mode: string;
  task_name_custom: string;
  start_date: string;
  assigned_by_id: string;
  task_detail: string;
  task_notes: string;
  instructions: string;
  instructions_locked: boolean;
  assigned_to_ids: string[];
  recurrence_type: RecurrenceType;
  recurrence_days: string[];
  recurrence_day_of_month: string;
  is_active: boolean;
}

const RECURRENCE_OPTIONS: { value: RecurrenceType; label: string; helper: string }[] = [
  { value: "daily", label: "Daily", helper: "Creates a task every day" },
  { value: "weekly", label: "Weekly", helper: "Use the days field to pick weekdays" },
  { value: "monthly", label: "Monthly", helper: "Runs on the selected day of month" },
  { value: "custom", label: "Custom days", helper: "Use the days field to pick specific weekdays" },
];

const RECURRENCE_DAY_OPTIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function todayLocal() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      ...(tz ? { timeZone: tz } : {}),
    });
  } catch {
    return iso;
  }
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


function templateAssignedToIds(template: RecurringTaskTemplate): string[] {
  const ids = template.assigned_to_ids?.filter(Boolean) ?? [];
  if (ids.length > 0) return ids;
  return template.assigned_to ? [template.assigned_to] : [];
}

function findObjectiveMatch(
  template: RecurringTaskTemplate,
  formObjectives: FormObjective[]
): FormObjective | null {
  const byAccount = formObjectives.filter((objective) => objective.account === template.account);
  const exact = byAccount.find((objective) => objective.project_name === (template.project ?? template.description ?? ""));
  return exact ?? byAccount[0] ?? null;
}

function findTaskMatch(
  template: RecurringTaskTemplate,
  objectiveId: string,
  formTasksByObjective: Record<number, FormTask[]>
) {
  const tasks = objectiveId ? formTasksByObjective[Number(objectiveId)] ?? [] : [];
  return tasks.find((task) => task.task_name === (template.title ?? template.task_name ?? "")) ?? null;
}

function defaultForm(): FormState {
  return {
    account: "",
    objective_id: "",
    objective_custom: "",
    task_name_mode: "",
    task_name_custom: "",
    start_date: todayLocal(),
    assigned_by_id: "",
    task_detail: "",
    task_notes: "",
    instructions: "",
    instructions_locked: false,
    assigned_to_ids: [],
    recurrence_type: "daily",
    recurrence_days: [],
    recurrence_day_of_month: "",
    is_active: true,
  };
}

function templateToForm(
  template: RecurringTaskTemplate,
  formObjectives: FormObjective[],
  formTasksByObjective: Record<number, FormTask[]>
): FormState {
  const objectiveMatch = findObjectiveMatch(template, formObjectives);
  const objectiveId = objectiveMatch ? String(objectiveMatch.id) : "__custom__";
  const taskMatch = objectiveMatch ? findTaskMatch(template, String(objectiveMatch.id), formTasksByObjective) : null;
  const assignedToIds = templateAssignedToIds(template);

  return {
    account: template.account ?? "",
    objective_id: objectiveId,
    objective_custom: objectiveMatch ? "" : (template.project ?? template.description ?? ""),
    task_name_mode: taskMatch ? taskMatch.task_name : "__custom__",
    task_name_custom: taskMatch ? "" : (template.title ?? template.task_name ?? ""),
    start_date: template.start_date ?? todayLocal(),
    assigned_by_id: template.assigned_by ?? "",
    task_detail: template.task_detail ?? template.description ?? "",
    task_notes: template.task_notes ?? "",
    instructions: template.instructions ?? "",
    instructions_locked: Boolean(template.instructions_locked),
    assigned_to_ids: assignedToIds,
    recurrence_type: template.recurrence_type,
    recurrence_days: template.recurrence_days ?? [],
    recurrence_day_of_month: template.recurrence_day_of_month?.toString() ?? "",
    is_active: template.is_active,
  };
}

function displayAssignedTo(
  template: RecurringTaskTemplate,
  activeProfiles: Profile[]
): string {
  const ids = templateAssignedToIds(template);
  if (ids.length === 0) return "—";
  const profileMap = new Map(activeProfiles.map((profile) => [profile.id, profile]));
  return ids
    .map((id) => profileLabel(profileMap.get(id) ?? { id, full_name: "", username: id }))
    .filter(Boolean)
    .join(", ");
}

interface TemplateVAMultiSelectProps {
  activeProfiles: Pick<Profile, "id" | "full_name" | "username">[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

function TemplateVAMultiSelect({ activeProfiles, selectedIds, onChange }: TemplateVAMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const openDropdown = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const maxHeight = Math.min(240, Math.max(spaceBelow, spaceAbove));
      const showAbove = spaceBelow < 120 && spaceAbove > spaceBelow;

      setDropdownStyle({
        position: "fixed",
        ...(showAbove ? { bottom: window.innerHeight - rect.top + 2 } : { top: rect.bottom + 2 }),
        left: rect.left,
        width: rect.width,
        maxHeight,
        zIndex: 9999,
      });
    }
    setOpen(true);
  };

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((value) => value !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const selectedProfiles = activeProfiles.filter((profile) => selectedIds.includes(profile.id));

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className="w-full flex items-center justify-between rounded-lg border border-sand bg-white px-3 py-2 text-[13px] outline-none transition-colors hover:border-walnut/40 focus:border-terracotta"
      >
        <span className="flex-1 text-left">
          {selectedProfiles.length === 0 ? (
            <span className="text-stone/50">Select team members...</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {selectedProfiles.map((profile) => (
                <span
                  key={profile.id}
                  className="inline-flex items-center gap-1 rounded-full border border-sand bg-parchment px-2 py-0.5 text-[11px] text-walnut"
                >
                  {profileLabel(profile)}
                </span>
              ))}
            </span>
          )}
        </span>
        <svg
          className={`ml-2 h-4 w-4 shrink-0 text-stone transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          ref={dropdownRef}
          style={dropdownStyle}
          className="overflow-y-auto rounded-lg border border-sand bg-white shadow-xl"
        >
          {activeProfiles.map((profile) => {
            const checked = selectedIds.includes(profile.id);
            return (
              <label
                key={profile.id}
                className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-parchment"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(profile.id)}
                  className="accent-terracotta"
                />
                <span className="flex-1 text-[13px] text-walnut">{profileLabel(profile)}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function displayObjective(template: RecurringTaskTemplate) {
  return template.project || template.description || template.task_detail || "—";
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RecurringTemplatesManager({
  templates,
  loading,
  activeProfiles,
  orgTimezone,
  accountOptions,
  projectTagsMap,
  formObjectives,
  formTasksByObjective,
  assignedByOptions,
  onRefresh,
}: RecurringTemplatesManagerProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringTaskTemplate | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const pendingFileInputRef = useRef<HTMLInputElement>(null);

  const assigneeOptions = useMemo(
    () => [...activeProfiles].sort((a, b) => profileLabel(a).localeCompare(profileLabel(b))),
    [activeProfiles]
  );

  const assignedBySorted = useMemo(
    () => [...assignedByOptions].sort((a, b) => profileLabel(a).localeCompare(profileLabel(b))),
    [assignedByOptions]
  );

  const objectiveOptions = useMemo(() => {
    const objectiveNames = new Map<number, FormObjective>();
    for (const objective of formObjectives) {
      if (form.account && objective.account !== form.account) continue;
      objectiveNames.set(objective.id, objective);
    }

    if (form.account && objectiveNames.size === 0) {
      for (const objective of formObjectives) {
        if (objective.account === form.account) objectiveNames.set(objective.id, objective);
      }
    }

    return Array.from(objectiveNames.values()).sort((a, b) => a.project_name.localeCompare(b.project_name));
  }, [form.account, formObjectives]);

  const selectedObjective = useMemo(() => {
    if (form.objective_id === "__custom__") return null;
    const parsed = Number(form.objective_id);
    if (!Number.isFinite(parsed)) return null;
    return formObjectives.find((objective) => objective.id === parsed) ?? null;
  }, [form.objective_id, formObjectives]);

  const taskOptions = useMemo(() => {
    if (!selectedObjective) return [];
    return [...(formTasksByObjective[selectedObjective.id] ?? [])].sort((a, b) => a.task_name.localeCompare(b.task_name));
  }, [formTasksByObjective, selectedObjective]);

  const accountSuggestions = useMemo(() => {
    const accounts = new Set<string>();
    for (const account of accountOptions) accounts.add(account);
    for (const account of Object.keys(projectTagsMap)) accounts.add(account);
    for (const objective of formObjectives) {
      if (objective.account) accounts.add(objective.account);
    }
    return Array.from(accounts).sort((a, b) => a.localeCompare(b));
  }, [accountOptions, formObjectives, projectTagsMap]);

  const fetchAttachments = useCallback(async (templateId: string) => {
    setAttachmentsLoading(true);
    try {
      const res = await fetch(`/api/recurring-task-templates/${templateId}/attachments`);
      if (res.ok) {
        const data = await res.json();
        setAttachments(data.attachments || []);
      } else {
        setAttachments([]);
      }
    } catch {
      setAttachments([]);
    } finally {
      setAttachmentsLoading(false);
    }
  }, []);

  const handlePendingFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setPendingFiles((prev) => [...prev, ...files]);
    event.target.value = "";
  }, []);

  const handleRemovePendingFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDeleteAttachment = useCallback(async (attachmentId: number) => {
    if (!editingTemplate) return;
    if (!confirm("Delete this attachment? This cannot be undone.")) return;

    try {
      const res = await fetch(
        `/api/recurring-task-templates/${editingTemplate.id}/attachments?attachmentId=${attachmentId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await fetchAttachments(editingTemplate.id);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Failed to delete attachment." });
    }
  }, [editingTemplate, fetchAttachments]);

  const openCreate = useCallback(() => {
    setEditingTemplate(null);
    setForm(defaultForm());
    setNotice(null);
    setAttachments([]);
    setPendingFiles([]);
    if (pendingFileInputRef.current) pendingFileInputRef.current.value = "";
    setPanelOpen(true);
  }, []);

  const openEdit = useCallback(
    (template: RecurringTaskTemplate) => {
      setEditingTemplate(template);
      setForm(templateToForm(template, formObjectives, formTasksByObjective));
      setNotice(null);
      setAttachments([]);
      setPendingFiles([]);
      if (pendingFileInputRef.current) pendingFileInputRef.current.value = "";
      setPanelOpen(true);
    },
    [formObjectives, formTasksByObjective]
  );

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setEditingTemplate(null);
    setNotice(null);
    setAttachments([]);
    setPendingFiles([]);
    if (pendingFileInputRef.current) pendingFileInputRef.current.value = "";
  }, []);

  useEffect(() => {
    if (!panelOpen || !editingTemplate) {
      if (!panelOpen) {
        setAttachments([]);
      }
      return;
    }

    void fetchAttachments(editingTemplate.id);
  }, [editingTemplate, fetchAttachments, panelOpen]);

  const saveTemplate = useCallback(async () => {
    const taskName = form.task_name_mode === "__custom__" || !form.task_name_mode ? form.task_name_custom.trim() : form.task_name_mode.trim();
    const objectiveName = form.objective_id === "__custom__" || !form.objective_id ? form.objective_custom.trim() : selectedObjective?.project_name?.trim() ?? "";

    if (!form.account.trim()) {
      setNotice({ type: "error", text: "Account is required." });
      return;
    }
    if (!objectiveName) {
      setNotice({ type: "error", text: "Objective is required." });
      return;
    }
    if (!taskName) {
      setNotice({ type: "error", text: "Task name is required." });
      return;
    }
    if (form.assigned_to_ids.length === 0) {
      setNotice({ type: "error", text: "Assign at least one VA." });
      return;
    }
    if (form.recurrence_type === "monthly" && !form.recurrence_day_of_month.trim()) {
      setNotice({ type: "error", text: "Monthly templates need a day of month." });
      return;
    }
    if ((form.recurrence_type === "weekly" || form.recurrence_type === "custom") && form.recurrence_days.length === 0) {
      setNotice({ type: "error", text: "Weekly/custom templates need at least one day." });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const payload = {
        title: taskName,
        task_name: taskName,
        description: form.task_detail.trim() || null,
        task_detail: form.task_detail.trim() || null,
        task_notes: form.task_notes.trim() || null,
        instructions: form.instructions.trim() || null,
        instructions_locked: form.instructions_locked,
        start_date: form.start_date || null,
        assigned_by: form.assigned_by_id || null,
        assigned_to_ids: form.assigned_to_ids,
        assigned_to: form.assigned_to_ids[0] ?? null,
        account: form.account.trim() || null,
        project: objectiveName,
        category: null,
        pay_type: null,
        recurrence_type: form.recurrence_type,
        recurrence_days: form.recurrence_days.length > 0 ? form.recurrence_days : null,
        recurrence_day_of_month: form.recurrence_day_of_month.trim() ? Number(form.recurrence_day_of_month.trim()) : null,
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

      const templateId = (data.template?.id as string | undefined) ?? editingTemplate?.id ?? null;
      onRefresh();

      if (templateId && pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          const formData = new FormData();
          formData.append("file", file);
          const uploadRes = await fetch(`/api/recurring-task-templates/${templateId}/attachments`, {
            method: "POST",
            body: formData,
          });
          if (!uploadRes.ok) {
            const uploadData = await uploadRes.json().catch(() => ({}));
            throw new Error(uploadData.error || `Failed to upload ${file.name}`);
          }
        }
      }

      if (templateId) {
        await fetchAttachments(templateId);
      }

      setPendingFiles([]);
      if (pendingFileInputRef.current) pendingFileInputRef.current.value = "";
      setNotice({ type: "success", text: editingTemplate ? "Template updated." : "Template created." });
      setPanelOpen(false);
      setEditingTemplate(null);
      setForm(defaultForm());
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Failed to save template." });
    } finally {
      setSaving(false);
    }
  }, [editingTemplate, fetchAttachments, form, onRefresh, pendingFiles, selectedObjective]);

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
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Task Name</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Account</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Objective</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Detail</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Assigned To</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Status</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Start Date</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wider text-walnut">Repeat</th>
                <th className="px-3 py-2.5 w-40"></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const assignedTo = displayAssignedTo(template, activeProfiles);
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
                  <p className="text-[11px] text-stone">Matches the task sidebar layout and saves to the recurring templates table.</p>
                </div>
                <button onClick={closePanel} className="text-stone hover:text-espresso cursor-pointer">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Account</label>
                  <select
                    value={form.account}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        account: e.target.value,
                        objective_id: "",
                        objective_custom: "",
                        task_name_mode: "",
                        task_name_custom: "",
                      }))
                    }
                    className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                  >
                    <option value="">Select account...</option>
                    {accountSuggestions.map((account) => (
                      <option key={account} value={account}>
                        {account}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Objective</label>
                  {objectiveOptions.length > 0 ? (
                    <select
                      value={form.objective_id}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          objective_id: e.target.value,
                          objective_custom: "",
                          task_name_mode: "",
                          task_name_custom: "",
                        }))
                      }
                      disabled={!form.account}
                      className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] outline-none focus:border-terracotta disabled:bg-parchment disabled:opacity-60"
                    >
                      <option value="">{form.account ? "Select objective..." : "Select account first..."}</option>
                      {objectiveOptions.map((objective) => (
                        <option key={objective.id} value={String(objective.id)}>
                          {objective.project_name}
                        </option>
                      ))}
                      <option value="__custom__">Custom objective...</option>
                    </select>
                  ) : (
                    <input
                      value={form.objective_custom}
                      onChange={(e) => setForm((prev) => ({ ...prev, objective_custom: e.target.value }))}
                      placeholder="Objective name"
                      disabled={!form.account}
                      className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta disabled:bg-parchment disabled:opacity-60"
                    />
                  )}
                  {form.objective_id === "__custom__" && (
                    <input
                      value={form.objective_custom}
                      onChange={(e) => setForm((prev) => ({ ...prev, objective_custom: e.target.value }))}
                      placeholder="Custom objective name"
                      className="mt-2 w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                    />
                  )}
                  {form.account && projectTagsMap[form.account]?.length ? (
                    <p className="mt-1 text-[11px] text-stone">
                      Suggested objectives: {projectTagsMap[form.account].slice(0, 6).join(", ")}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Task Name</label>
                  {taskOptions.length > 0 ? (
                    <select
                      value={form.task_name_mode}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          task_name_mode: e.target.value,
                          task_name_custom: "",
                        }))
                      }
                      disabled={!selectedObjective}
                      className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] outline-none focus:border-terracotta disabled:bg-parchment disabled:opacity-60"
                    >
                      <option value="">{selectedObjective ? "Select task..." : "Select objective first..."}</option>
                      {taskOptions.map((task) => (
                        <option key={task.id} value={task.task_name}>
                          {task.task_name}
                        </option>
                      ))}
                      <option value="__custom__">Custom task name...</option>
                    </select>
                  ) : (
                    <input
                      value={form.task_name_custom}
                      onChange={(e) => setForm((prev) => ({ ...prev, task_name_custom: e.target.value }))}
                      placeholder="Task name"
                      disabled={!selectedObjective && form.objective_id !== "__custom__" && !form.objective_custom.trim()}
                      className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta disabled:bg-parchment disabled:opacity-60"
                    />
                  )}
                  {form.task_name_mode === "__custom__" && (
                    <input
                      value={form.task_name_custom}
                      onChange={(e) => setForm((prev) => ({ ...prev, task_name_custom: e.target.value }))}
                      placeholder="Custom task name"
                      className="mt-2 w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                    />
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Start Date</label>
                    <input
                      type="date"
                      value={form.start_date}
                      onChange={(e) => setForm((prev) => ({ ...prev, start_date: e.target.value }))}
                      className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Assigned By</label>
                    <select
                      value={form.assigned_by_id}
                      onChange={(e) => setForm((prev) => ({ ...prev, assigned_by_id: e.target.value }))}
                      className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                    >
                      <option value="">Select assigned by...</option>
                      {assignedBySorted.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profileLabel(profile)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Detail</label>
                  <input
                    value={form.task_detail}
                    onChange={(e) => setForm((prev) => ({ ...prev, task_detail: e.target.value }))}
                    placeholder="Short summary or reference"
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Notes</label>
                  <textarea
                    value={form.task_notes}
                    onChange={(e) => setForm((prev) => ({ ...prev, task_notes: e.target.value }))}
                    rows={4}
                    placeholder="Detailed notes or context for the assignee"
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta resize-none"
                  />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-walnut">Instructions</label>
                    <label className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-stone">
                      <input
                        type="checkbox"
                        checked={form.instructions_locked}
                        onChange={(e) => setForm((prev) => ({ ...prev, instructions_locked: e.target.checked }))}
                        className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                      />
                      Locked
                    </label>
                  </div>
                  <textarea
                    value={form.instructions}
                    onChange={(e) => setForm((prev) => ({ ...prev, instructions: e.target.value }))}
                    rows={4}
                    placeholder="Instructions for the assignee"
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta resize-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Assigned To</label>
                  <TemplateVAMultiSelect
                    activeProfiles={assigneeOptions}
                    selectedIds={form.assigned_to_ids}
                    onChange={(ids) => setForm((prev) => ({ ...prev, assigned_to_ids: ids }))}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Repeat</label>
                  <select
                    value={form.recurrence_type}
                    onChange={(e) => setForm((prev) => ({ ...prev, recurrence_type: e.target.value as RecurrenceType }))}
                    className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] outline-none focus:border-terracotta"
                  >
                    {RECURRENCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-stone">{RECURRENCE_OPTIONS.find((option) => option.value === form.recurrence_type)?.helper}</p>
                </div>

                {(form.recurrence_type === "weekly" || form.recurrence_type === "custom") && (
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Days</label>
                    <div className="flex flex-wrap gap-2">
                      {RECURRENCE_DAY_OPTIONS.map((day) => {
                        const selected = form.recurrence_days.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                recurrence_days: prev.recurrence_days.includes(day)
                                  ? prev.recurrence_days.filter((value) => value !== day)
                                  : [...prev.recurrence_days, day],
                              }))
                            }
                            className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                              selected
                                ? "border-terracotta bg-terracotta-soft text-terracotta"
                                : "border-sand bg-parchment text-walnut"
                            }`}
                          >
                            {day}
                          </button>
                        );
                      })}
                    </div>
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
                      placeholder="e.g. 15"
                      className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta"
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

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-walnut">Attach Files</label>
                    <label className="inline-flex items-center gap-1.5 rounded-lg border border-sand bg-parchment px-3 py-1.5 text-[11px] font-semibold text-walnut transition-all cursor-pointer hover:border-walnut">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      Attach Files
                      <input
                        ref={pendingFileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={handlePendingFileSelect}
                      />
                    </label>
                  </div>

                  {pendingFiles.length === 0 ? (
                    <p className="py-2 text-[12px] text-stone/50">No files selected yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {pendingFiles.map((file, index) => (
                        <div
                          key={`${file.name}-${file.lastModified}-${index}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-sand bg-parchment/40 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <span className="block max-w-[280px] truncate text-[12px] text-walnut">{file.name}</span>
                            <span className="text-[10px] text-stone">{formatFileSize(file.size)}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemovePendingFile(index)}
                            className="shrink-0 rounded text-stone transition-all hover:text-terracotta cursor-pointer"
                            title="Remove file"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {editingTemplate && (
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-walnut">Existing Attachments</label>
                      {attachmentsLoading && (
                        <span className="text-[11px] text-stone">Loading...</span>
                      )}
                    </div>

                    {attachments.length === 0 ? (
                      <p className="py-2 text-[12px] text-stone/50">No saved attachments yet.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {attachments.map((attachment) => (
                          <div
                            key={attachment.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-sand bg-white px-3 py-2"
                          >
                            <div className="min-w-0">
                              <span className="block max-w-[280px] truncate text-[12px] text-walnut">{attachment.filename}</span>
                              <span className="text-[10px] text-stone">{formatFileSize(attachment.file_size)}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleDeleteAttachment(attachment.id)}
                              className="shrink-0 rounded text-stone transition-all hover:text-terracotta cursor-pointer"
                              title="Delete attachment"
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-sand px-6 py-4">
                <button onClick={closePanel} className="text-xs text-stone hover:text-espresso cursor-pointer">
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
        </div>
      )}
    </div>
  );
}
