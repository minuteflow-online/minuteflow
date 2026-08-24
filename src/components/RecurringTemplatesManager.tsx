"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import TaskEditor from "@/components/TaskEditor";
import ColumnHeader from "@/components/table/ColumnHeader";
import ColumnVisibilityPicker from "@/components/table/ColumnVisibilityPicker";
import PauseTemplateDialog from "@/components/ui/PauseTemplateDialog";
import { useColumnPrefs, type ColumnDef } from "@/components/table/useColumnPrefs";
import { orgWallClockToUtc, RECURRENCE_OPTIONS, type RecurrenceType } from "@/lib/taskSchedule";
import type { Profile, RecurringTaskTemplate } from "@/types/database";

const TEMPLATE_COLUMNS: ColumnDef[] = [
  { key: "task_name", label: "Task Name", defaultWidth: 200 },
  { key: "account", label: "Account", defaultWidth: 150 },
  { key: "project", label: "Project", defaultWidth: 150 },
  { key: "operation", label: "Operation", defaultWidth: 150 },
  { key: "detail", label: "Detail", defaultWidth: 220 },
  { key: "assigned_to", label: "Assigned To", defaultWidth: 160 },
  { key: "status", label: "Status", defaultWidth: 100 },
  { key: "start_date", label: "Start Date", defaultWidth: 120 },
  { key: "repeat", label: "Repeat", defaultWidth: 130 },
  { key: "created", label: "Created", defaultWidth: 150 },
];

type LinkedProject = { id: string; name: string };

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
  /** Rendered in the panel header, left of "New Template" — for controls that
   *  belong to this panel but are owned by the page (e.g. the VA view scope).
   *  Without this they end up stacked above the panel, reading as page chrome
   *  rather than as a control for the table underneath. */
  headerControls?: React.ReactNode;
  currentUserId?: string;
}

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

function displayProject(template: RecurringTaskTemplate) {
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
  headerControls,
}: RecurringTemplatesManagerProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringTaskTemplate | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Column widths and which columns show persist per user, same mechanism as
  // the Assignment task table.
  const { widths: columnWidths, hidden: hiddenColumns, setColumnWidth, toggleColumnVisible } = useColumnPrefs(
    "recurring-templates",
    currentUserId ?? null,
    TEMPLATE_COLUMNS
  );
  const show = useCallback((key: string) => !hiddenColumns.has(key), [hiddenColumns]);

  const [taskNameSearch, setTaskNameSearch] = useState("");
  const [filterTaskNames, setFilterTaskNames] = useState<string[]>([]);
  const [filterAccounts, setFilterAccounts] = useState<string[]>([]);
  const [filterProjects, setFilterProjects] = useState<string[]>([]);
  const [filterOperations, setFilterOperations] = useState<string[]>([]);
  const [filterAssignedTo, setFilterAssignedTo] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterRepeats, setFilterRepeats] = useState<string[]>([]);
  // Repeat and Active are the only fields a template has that a task doesn't.
  // Everything else on this panel is TaskEditor's own state.
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>("daily");
  const [isActive, setIsActive] = useState(true);

  // Self-fetched, same as TaskEditor's own linkedProjects — just for resolving
  // a template's project_id to a name in the table below. TaskEditor already
  // has the real "Link to Operations"/"Link to Objective" pickers; this is
  // only display, not another copy of that logic.
  const [linkedProjects, setLinkedProjects] = useState<LinkedProject[]>([]);
  useEffect(() => {
    fetch("/api/projects?mine=true", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setLinkedProjects(d.projects ?? []))
      .catch(() => {});
  }, []);
  const linkedProjectNameById = useMemo(
    () => new Map(linkedProjects.map((p) => [p.id, p.name])),
    [linkedProjects]
  );

  const assigneeOptions = useMemo(
    () => [...activeProfiles].sort((a, b) => profileLabel(a).localeCompare(profileLabel(b))),
    [activeProfiles]
  );

  const editorTeamMembers = useMemo(
    () => assigneeOptions.map((p) => ({ id: p.id, full_name: p.full_name, username: p.username })),
    [assigneeOptions]
  );

  // Filter option lists — distinct values from what's actually loaded, same
  // approach as the Assignment task table's own filter columns.
  const taskNameFilterOptions = useMemo(
    () => Array.from(new Set(templates.map((t) => t.title || t.task_name || "").filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [templates]
  );
  const accountFilterOptions = useMemo(
    () => Array.from(new Set(templates.map((t) => t.account ?? "").filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [templates]
  );
  const projectFilterOptions = useMemo(
    () => Array.from(new Set(templates.map((t) => displayProject(t)).filter((v) => v && v !== "—"))).sort((a, b) => a.localeCompare(b)),
    [templates]
  );
  const operationFilterOptions = useMemo(() => {
    const ids = new Set(templates.map((t) => t.project_id).filter((id): id is string => Boolean(id)));
    return Array.from(ids)
      .map((id) => ({ value: id, label: linkedProjectNameById.get(id) ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [templates, linkedProjectNameById]);
  const assignedToFilterOptions = useMemo(() => {
    const ids = new Set(templates.flatMap((t) => templateAssignedToIds(t)));
    const profileMap = new Map(activeProfiles.map((p) => [p.id, p]));
    return Array.from(ids)
      .map((id) => ({ value: id, label: profileLabel(profileMap.get(id) ?? { id, full_name: "", username: id }) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [templates, activeProfiles]);
  const repeatFilterOptions = useMemo(
    () => RECURRENCE_OPTIONS.filter((option) => templates.some((t) => t.recurrence_type === option.value))
      .map((option) => ({ value: option.value, label: option.label })),
    [templates]
  );

  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      const name = template.title || template.task_name || "";
      if (filterTaskNames.length > 0 && !filterTaskNames.includes(name)) return false;
      if (taskNameSearch && !name.toLowerCase().includes(taskNameSearch.toLowerCase())) return false;
      if (filterAccounts.length > 0 && !filterAccounts.includes(template.account ?? "")) return false;
      if (filterProjects.length > 0 && !filterProjects.includes(displayProject(template))) return false;
      if (filterOperations.length > 0 && !filterOperations.includes(template.project_id ?? "")) return false;
      if (filterAssignedTo.length > 0 && !templateAssignedToIds(template).some((id) => filterAssignedTo.includes(id))) return false;
      if (filterStatuses.length > 0 && !filterStatuses.includes(template.is_active ? "active" : "paused")) return false;
      if (filterRepeats.length > 0 && !filterRepeats.includes(template.recurrence_type)) return false;
      return true;
    });
  }, [templates, filterTaskNames, taskNameSearch, filterAccounts, filterProjects, filterOperations, filterAssignedTo, filterStatuses, filterRepeats]);

  // TaskEditor reads a task-shaped row, and a template is close enough to hand
  // it one directly — the column names line up on both sides. One exception:
  // a template's start_time/end_time are bare clock times ("09:00", no date —
  // each occurrence supplies its own), while TaskEditor always treats
  // initialTask.start_time/end_time as a full instant and runs them through
  // timeOfDay()/orgDateOf() unconditionally (src/lib/taskSchedule.ts). Handing
  // a bare "09:00" to `new Date("09:00")` produces an Invalid Date, and
  // formatToParts() on that throws — crashing the editor the instant you open
  // an existing template with a schedule set. Fixed by re-anchoring the clock
  // time onto a real date with the same conversion TaskEditor itself uses when
  // *saving* a task's hours (orgWallClockToUtc) — timeOfDay() then correctly
  // reads the same "HH:MM" back out on the other end. The anchor date doesn't
  // matter beyond being valid; only the time-of-day round-trips.
  const templateAsInitialTask = useMemo(() => {
    if (!editingTemplate) return null;
    const row = editingTemplate as unknown as Record<string, unknown>;
    const anchorDate = editingTemplate.start_date || new Date().toISOString().slice(0, 10);
    const toInstant = (clockTime: string | null | undefined) =>
      clockTime ? orgWallClockToUtc(anchorDate, clockTime) : clockTime;
    return {
      ...row,
      task_name: editingTemplate.title ?? editingTemplate.task_name ?? "",
      task_detail: editingTemplate.task_detail ?? editingTemplate.description ?? "",
      assigned_task_assignees: templateAssignedToIds(editingTemplate).map((va_id) => ({ va_id })),
      start_time: toInstant(editingTemplate.start_time),
      end_time: toInstant(editingTemplate.end_time),
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
  const [pausing, setPausing] = useState<RecurringTaskTemplate | null>(null);

  const setPaused = useCallback(
    async (template: RecurringTaskTemplate, pausedUntil: string | null) => {
      try {
        const res = await fetch(`/api/recurring-task-templates?id=${template.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: template.id, is_active: false, paused_until: pausedUntil }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        setPausing(null);
        onRefresh();
      } catch (error) {
        setNotice({ type: "error", text: error instanceof Error ? error.message : "Failed to pause template." });
      }
    },
    [onRefresh]
  );

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
        <div className="flex items-center gap-2">
        {headerControls}
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
        <>
        <div className="mb-3 flex items-center gap-2 text-[11px] text-stone">
          <span className="rounded-full bg-parchment px-2 py-0.5 font-semibold text-walnut">
            {filteredTemplates.length}
          </span>
          <span>template{filteredTemplates.length === 1 ? "" : "s"}</span>
          {(filterTaskNames.length > 0 || taskNameSearch || filterAccounts.length > 0 || filterProjects.length > 0 || filterOperations.length > 0 || filterAssignedTo.length > 0 || filterStatuses.length > 0 || filterRepeats.length > 0) && (
            <button
              type="button"
              onClick={() => {
                setFilterTaskNames([]);
                setTaskNameSearch("");
                setFilterAccounts([]);
                setFilterProjects([]);
                setFilterOperations([]);
                setFilterAssignedTo([]);
                setFilterStatuses([]);
                setFilterRepeats([]);
              }}
              className="text-terracotta hover:underline"
            >
              Clear filters
            </button>
          )}
          <div className="ml-auto">
            <ColumnVisibilityPicker
              columns={TEMPLATE_COLUMNS}
              hidden={hiddenColumns}
              onToggle={toggleColumnVisible}
            />
          </div>
        </div>
        <div className="rounded-xl border border-sand bg-white overflow-x-auto shadow-sm">
          <table className="min-w-full w-full">
            {/* Header renders unconditionally, independent of how many rows the
                filters leave — a filter narrowing results to zero used to take
                the whole table (header included) down with it, which left no
                way to see or clear the filter that caused it. */}
            <thead>
              <tr className="bg-parchment border-b border-sand">
                {show("task_name") && (
                  <ColumnHeader
                    label="Task Name"
                    width={columnWidths.task_name}
                    onResize={(w) => setColumnWidth("task_name", w)}
                    filterOptions={taskNameFilterOptions.map((v) => ({ value: v, label: v }))}
                    selected={filterTaskNames}
                    onFilterChange={setFilterTaskNames}
                    searchable
                    searchValue={taskNameSearch}
                    onSearchChange={setTaskNameSearch}
                    searchPlaceholder="Search task names..."
                  />
                )}
                {show("account") && (
                  <ColumnHeader
                    label="Account"
                    width={columnWidths.account}
                    onResize={(w) => setColumnWidth("account", w)}
                    filterOptions={accountFilterOptions.map((v) => ({ value: v, label: v }))}
                    selected={filterAccounts}
                    onFilterChange={setFilterAccounts}
                  />
                )}
                {show("project") && (
                  <ColumnHeader
                    label="Project"
                    width={columnWidths.project}
                    onResize={(w) => setColumnWidth("project", w)}
                    filterOptions={projectFilterOptions.map((v) => ({ value: v, label: v }))}
                    selected={filterProjects}
                    onFilterChange={setFilterProjects}
                  />
                )}
                {show("operation") && (
                  <ColumnHeader
                    label="Operation"
                    width={columnWidths.operation}
                    onResize={(w) => setColumnWidth("operation", w)}
                    filterOptions={operationFilterOptions}
                    selected={filterOperations}
                    onFilterChange={setFilterOperations}
                  />
                )}
                {show("detail") && (
                  <ColumnHeader label="Detail" width={columnWidths.detail} onResize={(w) => setColumnWidth("detail", w)} />
                )}
                {show("assigned_to") && (
                  <ColumnHeader
                    label="Assigned To"
                    width={columnWidths.assigned_to}
                    onResize={(w) => setColumnWidth("assigned_to", w)}
                    filterOptions={assignedToFilterOptions}
                    selected={filterAssignedTo}
                    onFilterChange={setFilterAssignedTo}
                  />
                )}
                {show("status") && (
                  <ColumnHeader
                    label="Status"
                    width={columnWidths.status}
                    onResize={(w) => setColumnWidth("status", w)}
                    filterOptions={[{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }]}
                    selected={filterStatuses}
                    onFilterChange={setFilterStatuses}
                  />
                )}
                {show("start_date") && (
                  <ColumnHeader label="Start Date" width={columnWidths.start_date} onResize={(w) => setColumnWidth("start_date", w)} />
                )}
                {show("repeat") && (
                  <ColumnHeader
                    label="Repeat"
                    width={columnWidths.repeat}
                    onResize={(w) => setColumnWidth("repeat", w)}
                    filterOptions={repeatFilterOptions}
                    selected={filterRepeats}
                    onFilterChange={setFilterRepeats}
                  />
                )}
                {show("created") && (
                  <ColumnHeader label="Created" width={columnWidths.created} onResize={(w) => setColumnWidth("created", w)} />
                )}
                <th className="px-3 py-2.5 w-40"></th>
              </tr>
            </thead>
            <tbody>
              {filteredTemplates.length === 0 ? (
                <tr>
                  <td colSpan={TEMPLATE_COLUMNS.length - hiddenColumns.size + 1} className="px-4 py-10 text-center text-sm text-stone">
                    No recurring templates match these filters.
                  </td>
                </tr>
              ) : filteredTemplates.map((template) => {
                const assignedTo = displayAssignedTo(template, activeProfiles, profilesLoaded);
                const statusClass = template.is_active ? "bg-sage-soft text-sage" : "bg-stone/10 text-stone";
                return (
                  <tr key={template.id} className="border-b border-sand last:border-0 hover:bg-parchment/30 transition-colors">
                    {show("task_name") && (
                      <td className="px-3 py-3 text-[13px] text-ink">
                        <button className="font-medium text-left hover:text-terracotta" onClick={() => openEdit(template)}>
                          {template.title || template.task_name || "Untitled template"}
                        </button>
                      </td>
                    )}
                    {show("account") && (
                      <td className="px-3 py-3 text-[13px] text-walnut">{template.account || "—"}</td>
                    )}
                    {show("project") && (
                      <td className="px-3 py-3 text-[13px] text-walnut">{displayProject(template)}</td>
                    )}
                    {show("operation") && (
                      <td className="px-3 py-3 text-[13px] text-walnut">
                        {template.project_id ? linkedProjectNameById.get(template.project_id) ?? "—" : "—"}
                      </td>
                    )}
                    {show("detail") && (
                      <td className="px-3 py-3 text-[13px] text-walnut">
                        <span className="block max-w-[240px] truncate" title={template.task_detail ?? template.description ?? ""}>
                          {template.task_detail ?? template.description ?? "—"}
                        </span>
                      </td>
                    )}
                    {show("assigned_to") && (
                      <td className="px-3 py-3 text-[13px] text-walnut">
                        <span className="block max-w-[240px] truncate" title={assignedTo}>
                          {assignedTo}
                        </span>
                      </td>
                    )}
                    {show("status") && (
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass}`}>
                          {template.is_active
                            ? "Active"
                            : template.paused_until
                              ? `Paused until ${formatDate(template.paused_until, orgTimezone)}`
                              : "Paused"}
                        </span>
                      </td>
                    )}
                    {show("start_date") && (
                      <td className="px-3 py-3 text-[13px] text-walnut">{formatDate(template.start_date, orgTimezone)}</td>
                    )}
                    {show("repeat") && (
                      <td className="px-3 py-3 text-[13px] text-walnut">{recurrenceLabel(template)}</td>
                    )}
                    {show("created") && (
                      <td className="px-3 py-3 text-[13px] text-walnut">
                        <div className="space-y-0.5">
                          <div className="truncate max-w-[140px]">
                            {template.created_by_profile?.full_name || template.created_by_profile?.username || "—"}
                          </div>
                          <div className="text-[11px] text-stone/70">{formatDate(template.created_at, orgTimezone)}</div>
                        </div>
                      </td>
                    )}
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(template)}
                          className="rounded-lg border border-sand px-3 py-1.5 text-[12px] text-walnut hover:border-walnut cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() =>
                            template.is_active ? setPausing(template) : void toggleActive(template)
                          }
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
        </>
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

      {pausing && (
        <PauseTemplateDialog
          templateName={pausing.title}
          onConfirm={(pausedUntil) => void setPaused(pausing, pausedUntil)}
          onCancel={() => setPausing(null)}
        />
      )}
    </div>
  );
}
