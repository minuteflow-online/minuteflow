"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { countWords } from "@/lib/utils";
import { CATEGORY_OPTIONS } from "@/lib/taskSchedule";

const CLIENT_MEMO_WORD_LIMIT = 15;

function limitToWords(text: string, limit: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return text;
  return words.slice(0, limit).join(" ");
}
import type { Profile, Project, ProjectKind } from "@/types/database";

interface VAProjectsTabProps {
  activeProfiles: Pick<Profile, "id" | "full_name" | "username">[];
  currentUserId: string;
  isAdmin?: boolean;
  kind: ProjectKind;
}

interface SubtaskRow {
  id: number;
  task_name: string;
  due_date: string | null;
  created_at: string | null;
  status: string;
  pay_type?: string | null;
  category?: string | null;
  project?: string | null;
  task_detail?: string | null;
  task_notes?: string | null;
  instructions?: string | null;
  account?: string | null;
  assigned_by: string | null;
  created_by?: string | null;
  created_by_profile?: { id: string; full_name: string; username: string } | null;
  review_required?: boolean;
  assigned_task_assignees: Array<{
    va_id: string;
    profiles?: { id: string; full_name: string; username: string } | null;
  }>;
}

interface AccountOption {
  id: number;
  name: string;
}

interface ObjectiveOption {
  id: number;
  account: string;
  project_name: string;
}

interface AddSubtaskForm {
  task_name: string;
  va_id: string;
  assigned_by_id: string;
  due_date: string;
  pay_type: string;
  category: string; // legacy Objective (project_tags) cascading value — NOT the color-coded task category
  task_category: string; // the real assigned_tasks.category (Task/Communication/Planning/...)
  task_detail: string;
  task_notes: string;
  instructions: string;
  status: string;
  review_required: boolean;
  parent_task_id: string;
}

function defaultSubtaskForm(assignedById = ""): AddSubtaskForm {
  return {
    task_name: "",
    va_id: "",
    assigned_by_id: assignedById,
    due_date: "",
    pay_type: "hourly",
    category: "",
    task_category: "Task",
    task_detail: "",
    task_notes: "",
    instructions: "",
    status: "pending",
    review_required: false,
    parent_task_id: "",
  };
}

const STATUS_OPTIONS = [
  "unassigned", "pending", "on_queue", "in_progress", "submitted",
  "reviewing", "revision_needed", "approved", "completed", "paid", "cancelled",
];

function profileLabel(p: Pick<Profile, "id" | "full_name" | "username">): string {
  return p.full_name || p.username || p.id;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

const STATUS_CLASSES: Record<string, string> = {
  on_queue: "bg-stone/10 text-stone border-stone/20",
  pending: "bg-stone/10 text-stone border-stone/20",
  unassigned: "bg-stone/10 text-stone border-stone/20",
  in_progress: "bg-amber-50 text-amber-500 border-amber-200",
  submitted: "bg-sky-50 text-sky-600 border-sky-200",
  reviewing: "bg-violet-50 text-violet-600 border-violet-200",
  revision_needed: "bg-amber-50 text-amber-600 border-amber-200",
  approved: "bg-emerald-50 text-emerald-600 border-emerald-200",
  completed: "bg-sage-soft text-sage border-sage/20",
  paid: "bg-purple-50 text-purple-600 border-purple-200",
  cancelled: "bg-red-50 text-red-500 border-red-200",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_CLASSES[status] ?? "bg-stone/10 text-stone border-stone/20";
  return (
    <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

const KIND_LABEL: Record<ProjectKind, string> = { objective: "Objective", operation: "Operation" };

export default function VAProjectsTab({ activeProfiles, currentUserId, isAdmin = false, kind }: VAProjectsTabProps) {
  const kindLabel = KIND_LABEL[kind];
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [objectiveOptions, setObjectiveOptions] = useState<Project[]>([]);

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [editName, setEditName] = useState("");
  const [editAccount, setEditAccount] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDetails, setEditDetails] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editVaIds, setEditVaIds] = useState<string[]>([]);
  const [editTargetDate, setEditTargetDate] = useState("");
  const [editLinkedObjectiveId, setEditLinkedObjectiveId] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editNotice, setEditNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createAccount, setCreateAccount] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createDetails, setCreateDetails] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [createVaIds, setCreateVaIds] = useState<string[]>([]);
  const [createParentId, setCreateParentId] = useState("");
  const [createTargetDate, setCreateTargetDate] = useState("");
  const [createLinkedObjectiveId, setCreateLinkedObjectiveId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [formProjects, setFormProjects] = useState<ObjectiveOption[]>([]);
  const [formTasksByObjective, setFormTasksByObjective] = useState<Record<number, Array<{ id: number; task_name: string }>>>({});

  const [subtasks, setSubtasks] = useState<SubtaskRow[]>([]);
  const [subtasksLoading, setSubtasksLoading] = useState(false);
  const [addForm, setAddForm] = useState<AddSubtaskForm>(defaultSubtaskForm(currentUserId));
  const [addingSub, setAddingSub] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingSubId, setEditingSubId] = useState<number | null>(null);
  const [editSubForm, setEditSubForm] = useState<AddSubtaskForm>(defaultSubtaskForm(currentUserId));
  const [savingSub, setSavingSub] = useState(false);
  const [editSubError, setEditSubError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects?mine=true&kind=${kind}`, { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      setProjects(d.projects ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  // Operations can optionally link to the Objective they serve
  useEffect(() => {
    if (kind !== "operation") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects?mine=true&kind=objective", { cache: "no-store" });
        if (res.ok && !cancelled) {
          const d = await res.json();
          setObjectiveOptions(d.projects ?? []);
        }
      } catch {
        // leave empty
      }
    })();
    return () => { cancelled = true; };
  }, [kind]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const p of projects) {
      const key = p.parent_project_id ?? "__root__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [projects]);

  const rootProjects = childrenByParent.get("__root__") ?? [];

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (!selectedProject) return;
    setEditName(selectedProject.name);
    setEditAccount(selectedProject.account ?? "");
    setEditDescription(selectedProject.description ?? "");
    setEditDetails(selectedProject.details ?? "");
    setEditNotes(selectedProject.notes ?? "");
    setEditTargetDate(selectedProject.target_date ?? "");
    setEditLinkedObjectiveId(selectedProject.linked_objective_id ?? "");
    setEditVaIds([]);
    setEditNotice(null);
    setSubtasks([]);
    setAddForm(defaultSubtaskForm(currentUserId));
    setAddError(null);
    setEditingSubId(null);
    void fetchSubtasks(selectedProject.id);
    void fetchVaAccess(selectedProject.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id]);

  const fetchVaAccess = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects?projectId=${projectId}&vaAccess=true`, { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      setEditVaIds(d.va_ids ?? []);
    } catch {
      // ignore
    }
  }, []);

  const fetchSubtasks = useCallback(async (projectId: string) => {
    setSubtasksLoading(true);
    try {
      const res = await fetch(`/api/assigned-tasks?projectId=${projectId}`, { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      setSubtasks(d.tasks ?? []);
    } catch {
      // ignore
    } finally {
      setSubtasksLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const accountsRes = await fetch("/api/accounts", { cache: "no-store" });
        if (accountsRes.ok && !cancelled) {
          const data = await accountsRes.json();
          const nextAccounts = Array.isArray(data.accounts)
            ? data.accounts
                .map((account: AccountOption) => ({ id: account.id, name: account.name }))
                .filter((account: AccountOption) => Boolean(account.name?.trim()))
            : [];
          setAccounts(nextAccounts);
        }
      } catch {
        // leave dropdowns empty if fetch fails
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedProject?.account) {
      setFormProjects([]);
      setFormTasksByObjective({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/task-form-options?account=${encodeURIComponent(selectedProject.account ?? "")}`,
          { cache: "no-store" }
        );
        if (res.ok && !cancelled) {
          const data = await res.json();
          setFormProjects(data.projects ?? []);
          setFormTasksByObjective(data.tasksByProject ?? {});
        }
      } catch {
        // leave dropdowns empty
      }
    })();
    return () => { cancelled = true; };
  }, [selectedProject?.id]);

  function getObjectiveTaskOptions(objectiveName: string): string[] {
    const proj = formProjects.find((p) => p.project_name === objectiveName);
    if (!proj) return [];
    return (formTasksByObjective[proj.id] ?? []).map((t) => t.task_name);
  }

  const handleSelectProject = (project: Project) => {
    setSelectedProject(project);
    setShowCreate(false);
  };

  const handleSaveEdit = async () => {
    if (!selectedProject) return;
    if (!editName.trim()) {
      setEditNotice({ type: "error", text: `${kindLabel} name is required.` });
      return;
    }
    setSavingEdit(true);
    setEditNotice(null);
    try {
      const res = await fetch(`/api/projects?id=${selectedProject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          account: editAccount.trim() || null,
          details: editDetails.trim() || null,
          notes: editNotes.trim() || null,
          va_ids: editVaIds,
          ...(kind === "objective" ? { target_date: editTargetDate || null } : {}),
          ...(kind === "operation" ? { linked_objective_id: editLinkedObjectiveId || null } : {}),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setEditNotice({ type: "success", text: `${kindLabel} saved.` });
      setSelectedProject((prev) =>
        prev
          ? {
              ...prev,
              name: editName.trim(),
              account: editAccount.trim() || null,
              details: editDetails.trim() || null,
              notes: editNotes.trim() || null,
              target_date: kind === "objective" ? (editTargetDate || null) : prev.target_date,
              linked_objective_id: kind === "operation" ? (editLinkedObjectiveId || null) : prev.linked_objective_id,
            }
          : prev
      );
      void fetchProjects();
    } catch (e) {
      setEditNotice({ type: "error", text: e instanceof Error ? e.message : "Failed to save." });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleActive = async (project: Project) => {
    try {
      const res = await fetch(`/api/projects?id=${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !project.is_active }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      if (selectedProject?.id === project.id) {
        setSelectedProject((prev) => prev ? { ...prev, is_active: !prev.is_active } : null);
      }
      void fetchProjects();
    } catch (e) {
      setEditNotice({ type: "error", text: e instanceof Error ? e.message : "Failed to update." });
    }
  };

  const handleDeleteProject = async (project: Project) => {
    if (!confirm(`Delete "${project.name}"? Subtasks will remain but will no longer be linked to it. It must have no sub-items nested under it.`)) return;
    try {
      const res = await fetch(`/api/projects?id=${project.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      if (selectedProject?.id === project.id) setSelectedProject(null);
      void fetchProjects();
    } catch (e) {
      setEditNotice({ type: "error", text: e instanceof Error ? e.message : "Failed to delete." });
    }
  };

  const handleCreateProject = async () => {
    if (!createName.trim()) {
      setCreateError(`${kindLabel} name is required.`);
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          account: createAccount.trim() || null,
          description: createDescription.trim() || null,
          details: createDetails.trim() || null,
          notes: createNotes.trim() || null,
          va_ids: createVaIds,
          kind,
          parent_project_id: createParentId || null,
          ...(kind === "objective" ? { target_date: createTargetDate || null } : {}),
          ...(kind === "operation" ? { linked_objective_id: createLinkedObjectiveId || null } : {}),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setCreateName("");
      setCreateAccount("");
      setCreateDescription("");
      setCreateDetails("");
      setCreateNotes("");
      setCreateVaIds([]);
      setCreateParentId("");
      setCreateTargetDate("");
      setCreateLinkedObjectiveId("");
      setShowCreate(false);
      if (createParentId) setExpandedIds((prev) => new Set(prev).add(createParentId));
      void fetchProjects();
      if (d.project) setSelectedProject(d.project as Project);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : `Failed to create ${kindLabel.toLowerCase()}.`);
    } finally {
      setCreating(false);
    }
  };

  const handleAddSubtask = async () => {
    if (!selectedProject) return;
    if (!addForm.task_name.trim()) {
      setAddError("Task name is required.");
      return;
    }
    setAddingSub(true);
    setAddError(null);
    try {
      const body: Record<string, unknown> = {
        task_name: addForm.task_name.trim(),
        account: selectedProject.account ?? null,
        project_id: selectedProject.id,
        project: addForm.category.trim() || null,
        due_date: addForm.due_date || null,
        pay_type: addForm.pay_type || "hourly",
        category: addForm.task_category,
        task_detail: addForm.task_detail.trim() || null,
        task_notes: addForm.task_notes.trim() || null,
        instructions: addForm.instructions.trim() || null,
        initial_status: addForm.status || "pending",
        assigned_by: addForm.assigned_by_id || null,
        review_required: addForm.review_required,
        parent_task_id: addForm.parent_task_id ? Number(addForm.parent_task_id) : null,
      };
      if (addForm.va_id) {
        body.va_ids = [addForm.va_id];
      }
      const res = await fetch("/api/assigned-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setAddForm(defaultSubtaskForm(currentUserId));
      void fetchSubtasks(selectedProject.id);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to add subtask.");
    } finally {
      setAddingSub(false);
    }
  };

  const handleSaveSubEdit = async () => {
    if (!editingSubId || !selectedProject) return;
    if (!editSubForm.task_name.trim()) {
      setEditSubError("Task name is required.");
      return;
    }
    setSavingSub(true);
    setEditSubError(null);
    try {
      const metaRes = await fetch(`/api/assigned-tasks/${editingSubId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_name: editSubForm.task_name.trim(),
          project: editSubForm.category.trim() || null,
          category: editSubForm.task_category,
          task_detail: editSubForm.task_detail.trim() || null,
          task_notes: editSubForm.task_notes.trim() || null,
          instructions: editSubForm.instructions.trim() || null,
          due_date: editSubForm.due_date || null,
          assigned_by: editSubForm.assigned_by_id || null,
          va_ids: editSubForm.va_id ? [editSubForm.va_id] : [],
          review_required: editSubForm.review_required,
        }),
      });
      if (!metaRes.ok) {
        const d = await metaRes.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${metaRes.status}`);
      }

      if (editSubForm.status) {
        const statusRes = await fetch(`/api/assigned-tasks/${editingSubId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: editSubForm.status }),
        });
        if (!statusRes.ok) {
          const d = await statusRes.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${statusRes.status}`);
        }
      }

      setEditingSubId(null);
      void fetchSubtasks(selectedProject.id);
    } catch (e) {
      setEditSubError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSavingSub(false);
    }
  };

  const objectiveNameById = new Map(objectiveOptions.map((o) => [o.id, o.name]));

  const openCreateForm = (parentId: string) => {
    setShowCreate(true);
    setSelectedProject(null);
    setCreateName("");
    setCreateAccount("");
    setCreateDescription("");
    setCreateDetails("");
    setCreateNotes("");
    setCreateVaIds([]);
    setCreateParentId(parentId);
    setCreateTargetDate("");
    setCreateLinkedObjectiveId("");
    setCreateError(null);
  };

  const renderNode = (project: Project, depth: number) => {
    const children = childrenByParent.get(project.id) ?? [];
    const isExpanded = expandedIds.has(project.id);
    return (
      <React.Fragment key={project.id}>
        <div
          onClick={() => handleSelectProject(project)}
          className={`flex flex-col gap-1 px-3 py-2.5 cursor-pointer transition-colors ${
            selectedProject?.id === project.id ? "bg-parchment" : "hover:bg-cream"
          }`}
          style={{ paddingLeft: 12 + depth * 16 }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 flex-1 min-w-0">
              {children.length > 0 ? (
                <button
                  onClick={(e) => { e.stopPropagation(); toggleExpand(project.id); }}
                  className="shrink-0 text-bark hover:text-espresso cursor-pointer text-[10px] w-3"
                >
                  {isExpanded ? "▼" : "▶"}
                </button>
              ) : (
                <span className="w-3 shrink-0" />
              )}
              <span className="text-[13px] font-semibold text-espresso leading-tight truncate">
                {project.name}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                title={`Add sub-${kindLabel.toLowerCase()}`}
                onClick={(e) => { e.stopPropagation(); openCreateForm(project.id); }}
                className="text-bark hover:text-espresso cursor-pointer text-[13px] leading-none px-1"
              >
                +
              </button>
              <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${
                project.is_active
                  ? "bg-sage-soft text-sage border-sage/20"
                  : "bg-stone/10 text-stone border-stone/20"
              }`}>
                {project.is_active ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
          {kind === "objective" && project.target_date && (
            <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full border bg-terracotta-soft text-terracotta border-terracotta/20 w-fit">
              Target: {formatDate(project.target_date)}
            </span>
          )}
          {kind === "operation" && project.linked_objective_id && (
            <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full border bg-plum-soft text-plum border-plum/20 w-fit">
              Supports: {objectiveNameById.get(project.linked_objective_id) ?? "Objective"}
            </span>
          )}
          {project.description && (
            <p className="text-[11px] text-stone/80 truncate">{project.description}</p>
          )}
          <p className="text-[10px] text-stone/60">{formatDate(project.created_at)}</p>
        </div>
        {isExpanded && children.map((child) => renderNode(child, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-walnut">My {kindLabel}s</h3>
          <p className="text-xs text-stone">
            {kind === "objective"
              ? "Nest goals and projects, then add subtasks assigned to VAs."
              : "Recurring, day-to-day work — optionally linked to the Objective it supports."}
          </p>
        </div>
        <button
          onClick={() => openCreateForm("")}
          className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840]"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New {kindLabel}
        </button>
      </div>

      <div className="flex gap-4 items-start">
        {/* ── Left panel: project tree ─────────────────────────────────────────── */}
        <div className="w-72 shrink-0 space-y-2">
          {loading ? (
            <div className="rounded-xl border border-sand bg-white p-4 text-center text-xs text-stone">
              Loading {kindLabel.toLowerCase()}s...
            </div>
          ) : rootProjects.length === 0 && !showCreate ? (
            <div className="rounded-xl border border-sand bg-white p-6 text-center">
              <p className="text-sm font-medium text-espresso">No {kindLabel.toLowerCase()}s yet</p>
              <p className="mt-1 text-xs text-stone">Click &ldquo;New {kindLabel}&rdquo; to get started.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-sand bg-white overflow-hidden shadow-sm divide-y divide-sand">
              {rootProjects.map((project) => renderNode(project, 0))}
            </div>
          )}
        </div>

        {/* ── Right panel ─────────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {/* Create project form */}
          {showCreate && (
            <div className="rounded-xl border border-sand bg-white p-5 shadow-sm space-y-4">
              <h4 className="text-[13px] font-bold text-espresso">New {kindLabel}</h4>
              {createParentId && (
                <p className="text-[11px] text-stone">
                  Nested under: <span className="font-semibold text-espresso">{projects.find((p) => p.id === createParentId)?.name}</span>{" "}
                  <button onClick={() => setCreateParentId("")} className="text-terracotta hover:underline cursor-pointer">
                    (make top-level)
                  </button>
                </p>
              )}

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                  {kindLabel} Name
                </label>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder={`${kindLabel} name`}
                  className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                />
              </div>

              {kind === "objective" && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                    Target Date
                  </label>
                  <input
                    type="date"
                    value={createTargetDate}
                    onChange={(e) => setCreateTargetDate(e.target.value)}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                  />
                </div>
              )}

              {kind === "operation" && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                    Supports Objective
                  </label>
                  <select
                    value={createLinkedObjectiveId}
                    onChange={(e) => setCreateLinkedObjectiveId(e.target.value)}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                  >
                    <option value="">— None —</option>
                    {objectiveOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                  Account
                </label>
                <select
                  value={createAccount}
                  onChange={(e) => setCreateAccount(e.target.value)}
                  className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                >
                  <option value="">Select account...</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.name}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                  Description
                </label>
                <textarea
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="Optional description"
                  rows={3}
                  className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white resize-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                  Details
                </label>
                <textarea
                  value={createDetails}
                  onChange={(e) => setCreateDetails(e.target.value)}
                  placeholder="Optional details"
                  rows={4}
                  className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white resize-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                  Notes
                </label>
                <textarea
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  placeholder="Optional notes"
                  rows={4}
                  className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white resize-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                  Assign VAs
                </label>
                <div className="flex flex-wrap gap-3 rounded-lg border border-sand bg-white px-3 py-2">
                  {activeProfiles.map((p) => (
                    <label key={p.id} className="flex items-center gap-1.5 text-[12px] text-espresso">
                      <input
                        type="checkbox"
                        checked={createVaIds.includes(p.id)}
                        onChange={(e) => {
                          setCreateVaIds((prev) =>
                            e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                          );
                        }}
                      />
                      {profileLabel(p)}
                    </label>
                  ))}
                </div>
              </div>

              {createError && (
                <p className="text-[12px] text-red-600">{createError}</p>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleCreateProject()}
                  disabled={creating}
                  className="px-4 py-2 rounded-lg bg-sage text-white text-[13px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
                >
                  {creating ? "Creating..." : `Create ${kindLabel}`}
                </button>
                <button
                  onClick={() => { setShowCreate(false); setCreateError(null); setCreateParentId(""); }}
                  className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Selected project detail */}
          {selectedProject && !showCreate && (
            <div className="space-y-4">
              {/* Project edit card */}
              <div className="rounded-xl border border-sand bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[13px] font-bold text-espresso">{kindLabel} Details</h4>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void handleToggleActive(selectedProject)}
                      className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
                    >
                      {selectedProject.is_active ? "Deactivate" : "Activate"}
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => void handleDeleteProject(selectedProject)}
                        className="px-3 py-1 rounded-lg text-[11px] font-semibold border border-red-200 text-red-600 hover:border-red-400 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                    {kindLabel} Name
                  </label>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                  />
                </div>

                {kind === "objective" && (
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                      Target Date
                    </label>
                    <input
                      type="date"
                      value={editTargetDate}
                      onChange={(e) => setEditTargetDate(e.target.value)}
                      className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                    />
                  </div>
                )}

                {kind === "operation" && (
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                      Supports Objective
                    </label>
                    <select
                      value={editLinkedObjectiveId}
                      onChange={(e) => setEditLinkedObjectiveId(e.target.value)}
                      className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                    >
                      <option value="">— None —</option>
                      {objectiveOptions.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                    Account
                  </label>
                  <select
                    value={editAccount}
                    onChange={(e) => setEditAccount(e.target.value)}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                  >
                    <option value="">Select account...</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.name}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                    Description
                  </label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={3}
                    placeholder="Optional description"
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white resize-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                    Details
                  </label>
                  <textarea
                    value={editDetails}
                    onChange={(e) => setEditDetails(e.target.value)}
                    rows={4}
                    placeholder="Optional details"
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white resize-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                    Notes
                  </label>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={4}
                    placeholder="Optional notes"
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white resize-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                    Assigned VAs
                  </label>
                  <div className="flex flex-wrap gap-3 rounded-lg border border-sand bg-white px-3 py-2">
                    {activeProfiles.map((p) => (
                      <label key={p.id} className="flex items-center gap-1.5 text-[12px] text-espresso">
                        <input
                          type="checkbox"
                          checked={editVaIds.includes(p.id)}
                          onChange={(e) => {
                            setEditVaIds((prev) =>
                              e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                            );
                          }}
                        />
                        {profileLabel(p)}
                      </label>
                    ))}
                  </div>
                </div>

                {editNotice && (
                  <div className={`rounded-lg border px-3 py-2 text-[12px] ${
                    editNotice.type === "success"
                      ? "border-sage-soft bg-sage-soft text-sage"
                      : "border-red-200 bg-red-50 text-red-600"
                  }`}>
                    {editNotice.text}
                  </div>
                )}

                <button
                  onClick={() => void handleSaveEdit()}
                  disabled={savingEdit}
                  className="px-4 py-2 rounded-lg bg-sage text-white text-[13px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
                >
                  {savingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>

              {/* Subtasks card */}
              <div className="rounded-xl border border-sand bg-white p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-espresso uppercase tracking-wide">Subtasks</h4>
                  {subtasksLoading && (
                    <span className="text-[11px] text-stone">Loading...</span>
                  )}
                </div>

                {!subtasksLoading && subtasks.length === 0 && (
                  <p className="text-[12px] text-stone/70">No subtasks yet. Add one below.</p>
                )}

                {subtasks.length > 0 && (
                  <div className="space-y-1.5">
                    {subtasks.map((sub) => {
                      const assignees = sub.assigned_task_assignees ?? [];
                      const assigneeNames = assignees
                        .map((a) => a.profiles?.full_name || a.profiles?.username || a.va_id)
                        .join(", ");
                      const isEditing = editingSubId === sub.id;

                      return (
                        <div key={sub.id} className="space-y-1">
                          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-sand bg-white hover:bg-cream transition-colors">
                            <StatusBadge status={sub.status} />
                            <span className="flex-1 text-[13px] font-semibold text-espresso leading-tight truncate">
                              {sub.task_name}
                            </span>
                            {(sub.project || sub.category) && (
                              <span className="text-[11px] text-stone shrink-0 hidden sm:block">
                                {sub.project ?? sub.category}
                              </span>
                            )}
                            {assigneeNames && (
                              <span className="text-[11px] text-stone shrink-0 hidden sm:block">
                                {assigneeNames}
                              </span>
                            )}
                            {sub.account && (
                              <span className="text-[11px] text-stone shrink-0 hidden md:block">
                                {sub.account}
                              </span>
                            )}
                            {sub.due_date && (
                              <span className="text-[11px] text-stone shrink-0 hidden md:block">
                                Due: {formatDate(sub.due_date)}
                              </span>
                            )}
                            {sub.created_at && (
                              <span className="text-[11px] text-stone/60 shrink-0 hidden lg:block">
                                {sub.created_by_profile?.full_name || sub.created_by_profile?.username
                                  ? `${sub.created_by_profile.full_name || sub.created_by_profile.username} · `
                                  : ""}
                                {formatDate(sub.created_at)}
                              </span>
                            )}
                            {sub.pay_type && (
                              <span className="text-[11px] text-stone capitalize shrink-0 hidden lg:block">
                                {sub.pay_type.replace(/_/g, " ")}
                              </span>
                            )}
                            <button
                              onClick={() => {
                                if (isEditing) {
                                  setEditingSubId(null);
                                } else {
                                  setEditingSubId(sub.id);
                                  setEditSubForm({
                                    task_name: sub.task_name,
                                    va_id: assignees[0]?.va_id ?? "",
                                    assigned_by_id: sub.assigned_by ?? "",
                                    due_date: sub.due_date ?? "",
                                    pay_type: sub.pay_type ?? "hourly",
                                    category: sub.project ?? "",
                                    task_category: sub.category && CATEGORY_OPTIONS.includes(sub.category) ? sub.category : "Task",
                                    task_detail: sub.task_detail ?? "",
                                    task_notes: sub.task_notes ?? "",
                                    instructions: sub.instructions ?? "",
                                    status: sub.status ?? "pending",
                                    review_required: sub.review_required ?? false,
                                    parent_task_id: "",
                                  });
                                  setEditSubError(null);
                                }
                              }}
                              className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors shrink-0"
                            >
                              {isEditing ? "Cancel" : "Edit"}
                            </button>
                          </div>

                          {/* Inline edit form */}
                          {isEditing && (
                            <div className="ml-3 rounded-lg border border-sand bg-parchment p-3 space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
                                    Objective
                                  </label>
                                  <select
                                    value={editSubForm.category}
                                    onChange={(e) => setEditSubForm((prev) => ({
                                      ...prev,
                                      category: e.target.value,
                                      task_name: "",
                                    }))}
                                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white"
                                  >
                                    <option value="">Select objective...</option>
                                    {formProjects.map((p) => (
                                      <option key={p.id} value={p.project_name}>{p.project_name}</option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
                                    Task Name
                                  </label>
                                  <select
                                    value={editSubForm.task_name}
                                    onChange={(e) => setEditSubForm((prev) => ({ ...prev, task_name: e.target.value }))}
                                    disabled={!editSubForm.category}
                                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white disabled:opacity-60 disabled:bg-parchment"
                                  >
                                    <option value="">
                                      {!editSubForm.category ? "Select objective first..." : "Select task..."}
                                    </option>
                                    {getObjectiveTaskOptions(editSubForm.category).map((t) => (
                                      <option key={t} value={t}>{t}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              <div>
                                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
                                  Category
                                </label>
                                <select
                                  value={editSubForm.task_category}
                                  onChange={(e) => setEditSubForm((prev) => ({ ...prev, task_category: e.target.value }))}
                                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white"
                                >
                                  {CATEGORY_OPTIONS.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
                                  Detail
                                </label>
                                <textarea
                                  value={editSubForm.task_detail}
                                  onChange={(e) => setEditSubForm((prev) => ({ ...prev, task_detail: limitToWords(e.target.value, CLIENT_MEMO_WORD_LIMIT) }))}
                                  rows={1}
                                  placeholder="Task detail"
                                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white resize-none"
                                />
                                <p className="text-[10px] text-stone mt-1">
                                  {Math.max(0, CLIENT_MEMO_WORD_LIMIT - countWords(editSubForm.task_detail))} words remaining
                                </p>
                              </div>

                              <div>
                                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
                                  Notes
                                </label>
                                <textarea
                                  value={editSubForm.task_notes}
                                  onChange={(e) => setEditSubForm((prev) => ({ ...prev, task_notes: e.target.value }))}
                                  rows={2}
                                  placeholder="Task notes"
                                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white resize-none"
                                />
                              </div>

                              <div>
                                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
                                  Instructions
                                </label>
                                <textarea
                                  value={editSubForm.instructions}
                                  onChange={(e) => setEditSubForm((prev) => ({ ...prev, instructions: e.target.value }))}
                                  rows={2}
                                  placeholder="Instructions for VA"
                                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white resize-none"
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
                                    Assign To
                                  </label>
                                  <select
                                    value={editSubForm.va_id}
                                    onChange={(e) => setEditSubForm((prev) => ({ ...prev, va_id: e.target.value }))}
                                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white"
                                  >
                                    <option value="">Unassigned</option>
                                    {activeProfiles.map((p) => (
                                      <option key={p.id} value={p.id}>{profileLabel(p)}</option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
                                    Assigned By
                                  </label>
                                  <select
                                    value={editSubForm.assigned_by_id}
                                    onChange={(e) => setEditSubForm((prev) => ({ ...prev, assigned_by_id: e.target.value }))}
                                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white"
                                  >
                                    <option value="">—</option>
                                    {activeProfiles.map((p) => (
                                      <option key={p.id} value={p.id}>{profileLabel(p)}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              <div className="grid grid-cols-3 gap-3">
                                <div>
                                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
                                    Status
                                  </label>
                                  <select
                                    value={editSubForm.status}
                                    onChange={(e) => setEditSubForm((prev) => ({ ...prev, status: e.target.value }))}
                                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white"
                                  >
                                    {STATUS_OPTIONS.map((s) => (
                                      <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
                                    Due Date
                                  </label>
                                  <input
                                    type="date"
                                    value={editSubForm.due_date}
                                    onChange={(e) => setEditSubForm((prev) => ({ ...prev, due_date: e.target.value }))}
                                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white"
                                  />
                                </div>

                                <div>
                                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
                                    Pay Type
                                  </label>
                                  <select
                                    value={editSubForm.pay_type}
                                    onChange={(e) => setEditSubForm((prev) => ({ ...prev, pay_type: e.target.value }))}
                                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white"
                                  >
                                    <option value="hourly">Time-based</option>
                                    <option value="fixed_pay">Output Based</option>
                                  </select>
                                </div>
                              </div>

                              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-walnut">
                                <input
                                  type="checkbox"
                                  checked={editSubForm.review_required}
                                  onChange={(e) => setEditSubForm((prev) => ({ ...prev, review_required: e.target.checked }))}
                                />
                                Review Required
                              </label>

                              {editSubError && (
                                <p className="text-[11px] text-red-600">{editSubError}</p>
                              )}

                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => void handleSaveSubEdit()}
                                  disabled={savingSub}
                                  className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
                                >
                                  {savingSub ? "Saving..." : "Save"}
                                </button>
                                <button
                                  onClick={() => setEditingSubId(null)}
                                  className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add subtask form */}
                <div className="border-t border-sand pt-4 space-y-3">
                  <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">Add Subtask</p>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                        Objective
                      </label>
                      <select
                        value={addForm.category}
                        onChange={(e) => setAddForm((prev) => ({
                          ...prev,
                          category: e.target.value,
                          task_name: "",
                        }))}
                        className="w-full rounded-lg border border-sand px-2 py-1.5 text-[13px] outline-none focus:border-terracotta bg-white"
                      >
                        <option value="">Select objective...</option>
                        {formProjects.map((p) => (
                          <option key={p.id} value={p.project_name}>{p.project_name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                        Account
                      </label>
                      <div className="rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso">
                        {selectedProject.account || "—"}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                      Task Name
                    </label>
                    <select
                      value={addForm.task_name}
                      onChange={(e) => setAddForm((prev) => ({ ...prev, task_name: e.target.value }))}
                      disabled={!addForm.category}
                      className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white disabled:opacity-60 disabled:bg-parchment"
                    >
                      <option value="">
                        {!addForm.category ? "Select objective first..." : "Select task..."}
                      </option>
                      {getObjectiveTaskOptions(addForm.category).map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                      Category
                    </label>
                    <select
                      value={addForm.task_category}
                      onChange={(e) => setAddForm((prev) => ({ ...prev, task_category: e.target.value }))}
                      className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                    >
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>

                  {subtasks.length > 0 && (
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                        Parent Task
                      </label>
                      <select
                        value={addForm.parent_task_id}
                        onChange={(e) => setAddForm((prev) => ({ ...prev, parent_task_id: e.target.value }))}
                        className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                      >
                        <option value="">Top-level task in this project</option>
                        {subtasks.map((t) => (
                          <option key={t.id} value={t.id}>Subtask of: {t.task_name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                      Detail
                    </label>
                    <textarea
                      value={addForm.task_detail}
                      onChange={(e) => setAddForm((prev) => ({ ...prev, task_detail: limitToWords(e.target.value, CLIENT_MEMO_WORD_LIMIT) }))}
                      rows={1}
                      placeholder="Task detail"
                      className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white resize-none"
                    />
                    <p className="text-[10px] text-stone mt-1">
                      {Math.max(0, CLIENT_MEMO_WORD_LIMIT - countWords(addForm.task_detail))} words remaining
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                      Notes
                    </label>
                    <textarea
                      value={addForm.task_notes}
                      onChange={(e) => setAddForm((prev) => ({ ...prev, task_notes: e.target.value }))}
                      rows={3}
                      placeholder="Task notes"
                      className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white resize-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                      Instructions
                    </label>
                    <textarea
                      value={addForm.instructions}
                      onChange={(e) => setAddForm((prev) => ({ ...prev, instructions: e.target.value }))}
                      rows={3}
                      placeholder="Instructions"
                      className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                        Assign To
                      </label>
                      <select
                        value={addForm.va_id}
                        onChange={(e) => setAddForm((prev) => ({ ...prev, va_id: e.target.value }))}
                        className="w-full rounded-lg border border-sand px-2 py-1.5 text-[13px] outline-none focus:border-terracotta bg-white"
                      >
                        <option value="">Unassigned</option>
                        {activeProfiles.map((p) => (
                          <option key={p.id} value={p.id}>{profileLabel(p)}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                        Assigned By
                      </label>
                      <select
                        value={addForm.assigned_by_id}
                        onChange={(e) => setAddForm((prev) => ({ ...prev, assigned_by_id: e.target.value }))}
                        className="w-full rounded-lg border border-sand px-2 py-1.5 text-[13px] outline-none focus:border-terracotta bg-white"
                      >
                        <option value="">—</option>
                        {activeProfiles.map((p) => (
                          <option key={p.id} value={p.id}>{profileLabel(p)}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                        Status
                      </label>
                      <select
                        value={addForm.status}
                        onChange={(e) => setAddForm((prev) => ({ ...prev, status: e.target.value }))}
                        className="w-full rounded-lg border border-sand px-2 py-1.5 text-[13px] outline-none focus:border-terracotta bg-white"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                        Due Date
                      </label>
                      <input
                        type="date"
                        value={addForm.due_date}
                        onChange={(e) => setAddForm((prev) => ({ ...prev, due_date: e.target.value }))}
                        className="w-full rounded-lg border border-sand px-2 py-1.5 text-[13px] outline-none focus:border-terracotta bg-white"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                        Pay Type
                      </label>
                      <select
                        value={addForm.pay_type}
                        onChange={(e) => setAddForm((prev) => ({ ...prev, pay_type: e.target.value }))}
                        className="w-full rounded-lg border border-sand px-2 py-1.5 text-[13px] outline-none focus:border-terracotta bg-white"
                      >
                        <option value="hourly">Time-based</option>
                        <option value="fixed_pay">Output Based</option>
                      </select>
                    </div>
                  </div>

                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-walnut">
                    <input
                      type="checkbox"
                      checked={addForm.review_required}
                      onChange={(e) => setAddForm((prev) => ({ ...prev, review_required: e.target.checked }))}
                    />
                    Review Required
                  </label>

                  {addError && (
                    <p className="text-[12px] text-red-600">{addError}</p>
                  )}

                  <button
                    onClick={() => void handleAddSubtask()}
                    disabled={addingSub}
                    className="px-4 py-2 rounded-lg bg-sage text-white text-[13px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
                  >
                    {addingSub ? "Adding..." : "Add Subtask"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Empty state when nothing selected */}
          {!selectedProject && !showCreate && (
            <div className="rounded-xl border border-sand bg-white p-8 shadow-sm text-center">
              <p className="text-sm font-medium text-espresso">Select a project</p>
              <p className="mt-1 text-xs text-stone">Click a project on the left to view and manage its subtasks.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
