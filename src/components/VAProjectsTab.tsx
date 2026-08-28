"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TaskEditor, { type TaskEditorHandle } from "@/components/TaskEditor";
import RecurringTemplatePanel from "@/components/RecurringTemplatePanel";
import SubtaskBoardView from "@/components/SubtaskBoardView";
import ProjectMessageBoard from "@/components/ProjectMessageBoard";
import ProjectFiles from "@/components/ProjectFiles";
import ObjectiveOverview from "@/components/ObjectiveOverview";
import { assigneeNames as subtaskAssigneeNames } from "@/lib/subtaskDisplay";
import { collapseRecurringSeries } from "@/lib/taskSchedule";
import type { Profile, Project, ProjectKind, RecurringTaskTemplate } from "@/types/database";

interface VAProjectsTabProps {
  activeProfiles: Pick<Profile, "id" | "full_name" | "username">[];
  currentUserId: string;
  isAdmin?: boolean;
  kind: ProjectKind;
}

/** An Output Based subtask — a fixed_pay_tasks row, not an assigned_tasks one. */
export interface OutputSubtaskRow {
  id: number;
  task_name: string;
  status: string;
  rate: number | null;
  account?: string | null;
  project?: string | null;
  category?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  due_date?: string | null;
  assigned_to?: string | null;
  created_at?: string | null;
}

export interface SubtaskRow {
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
  recurring_template_id?: string | null;
  assigned_task_assignees: Array<{
    va_id: string;
    profiles?: { id: string; full_name: string; username: string } | null;
  }>;
}

interface AccountOption {
  id: number;
  name: string;
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

const RECURRENCE_LABEL: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  every_2_months: "Every 2 months",
  every_3_months: "Every 3 months",
};

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

// Order a flat project list parent→child and indent sub-items with a ↳ marker,
// so every objective/operation dropdown shows its hierarchy. Items whose parent
// isn't in the list are treated as roots.
function toHierOptions(list: Project[]): { id: string; label: string }[] {
  const ids = new Set(list.map((p) => p.id));
  const byParent = new Map<string, Project[]>();
  const roots: Project[] = [];
  for (const p of list) {
    const parent = p.parent_project_id && ids.has(p.parent_project_id) ? p.parent_project_id : null;
    if (parent) {
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent)!.push(p);
    } else {
      roots.push(p);
    }
  }
  const out: { id: string; label: string }[] = [];
  const walk = (nodes: Project[], depth: number) => {
    for (const p of nodes) {
      out.push({ id: p.id, label: depth === 0 ? p.name : `${"   ".repeat(depth)}↳ ${p.name}` });
      walk(byParent.get(p.id) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

// Project-level status (distinct from the Active/Inactive toggle and from subtask status).
const PROJECT_STATUS_OPTIONS: { value: string; label: string; cls: string }[] = [
  { value: "planning", label: "Planning", cls: "bg-slate-blue-soft text-slate-blue border-slate-blue/20" },
  { value: "active", label: "Active", cls: "bg-sage-soft text-sage border-sage/20" },
  { value: "on_hold", label: "On hold", cls: "bg-amber-50 text-amber-600 border-amber-200" },
  { value: "done", label: "Done", cls: "bg-emerald-50 text-emerald-600 border-emerald-200" },
];
const PROJECT_STATUS_BY_VALUE = new Map(PROJECT_STATUS_OPTIONS.map((s) => [s.value, s]));

// Statuses counted as "done" for the "Where They Are" completed/total figure.
const DONE_STATUSES = new Set(["completed", "approved", "paid"]);

export default function VAProjectsTab({ activeProfiles, currentUserId, isAdmin = false, kind }: VAProjectsTabProps) {
  const kindLabel = KIND_LABEL[kind];
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Which objectives have their linked-operations chips expanded. Collapsed by
  // default so the list stays calm — the wall of Op pills was overwhelming.
  const [expandedOpsIds, setExpandedOpsIds] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // A linked Operation opened for read-only viewing from an Objective (edited at
  // its origin in the Operations tab).
  const [viewOperation, setViewOperation] = useState<Project | null>(null);
  const [viewOperationSubtasks, setViewOperationSubtasks] = useState<SubtaskRow[]>([]);
  const [viewOperationSubtasksLoading, setViewOperationSubtasksLoading] = useState(false);
  const visibleViewOperationSubtasks = useMemo(
    () => collapseRecurringSeries(viewOperationSubtasks),
    [viewOperationSubtasks]
  );
  const [objectiveOptions, setObjectiveOptions] = useState<Project[]>([]);
  // Reverse of objectiveOptions: on the Objective tab, the Operations that link
  // to each objective (read-only here — edited at their origin in Operations).
  const [linkedOperations, setLinkedOperations] = useState<Project[]>([]);

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  // Lighter default view (Figma reference, docs/objective-foundation-feature.md):
  // Objective Details form is hidden until requested, rather than shown by default.
  // Local/testing-only per Neil — not boss-approved as the permanent default yet.
  const [showDetails, setShowDetails] = useState(false);
  // Subtasks card collapsible too (open by default), matching the Details/Docs cards.
  const [showSubtasks, setShowSubtasks] = useState(true);
  // Search box under "New" that filters the left list by name (self or descendant).
  const [listSearch, setListSearch] = useState("");
  // Bumped after a subtask is created so the scoped dashboard re-fetches.
  const [dashboardRefresh, setDashboardRefresh] = useState(0);
  // Tab for the inside-a-project view (shared box with tabs).
  const [scopedTab, setScopedTab] = useState<"board" | "details" | "subtasks" | "overview" | "docs">("board");
  // Landing overview (nothing selected) is also tab-based — one big box instead
  // of the 4-card grid, so each section gets room.
  const [landingTab, setLandingTab] = useState<"board" | "overview" | "docs" | "subtasks">("board");
  // Add-subtask mode — time-based (hourly) or output-based (fixed pay).
  const [addSubtaskMode, setAddSubtaskMode] = useState<"time_based" | "output_based">("time_based");
  // Per-VA "Where They Are" breakdown, collapsed by default — Overall Progress
  // above it already gives the at-a-glance number; this saves the vertical
  // space until someone actually wants the per-VA detail (per Toni).
  const [showVaProgress, setShowVaProgress] = useState(false);
  const [subtaskView, setSubtaskView] = useState<"list" | "board" | "checklist">("checklist");
  // "Add Subtask" form collapsed by default (Figma correction) — same
  // show-on-demand pattern as showDetails above.
  const [showAddSubtask, setShowAddSubtask] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAccount, setEditAccount] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDetails, setEditDetails] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editVaIds, setEditVaIds] = useState<string[]>([]);
  const [editTargetDate, setEditTargetDate] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editProjectStatus, setEditProjectStatus] = useState("active");
  const [editLinkedObjectiveId, setEditLinkedObjectiveId] = useState("");
  const [editParentId, setEditParentId] = useState("");
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
  const [createStartDate, setCreateStartDate] = useState("");
  const [createProjectStatus, setCreateProjectStatus] = useState("active");
  const [createLinkedObjectiveId, setCreateLinkedObjectiveId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<AccountOption[]>([]);

  const [subtasks, setSubtasks] = useState<SubtaskRow[]>([]);
  const [outputSubtasks, setOutputSubtasks] = useState<OutputSubtaskRow[]>([]);
  const [editingOutputId, setEditingOutputId] = useState<number | null>(null);
  const [deletingOutputId, setDeletingOutputId] = useState<number | null>(null);
  const [subtasksLoading, setSubtasksLoading] = useState(false);
  const [addFormKey, setAddFormKey] = useState(0);
  // Surfaced when a Board View drag's status update fails and gets rolled
  // back — otherwise a failed drag just silently snaps the card back with no
  // explanation, unlike the list-view edit form's editSubError.

  const [editingSubId, setEditingSubId] = useState<number | null>(null);
  const [deletingSubId, setDeletingSubId] = useState<number | null>(null);
  const [viewingSubId, setViewingSubId] = useState<number | null>(null);
  const [subtaskPage, setSubtaskPage] = useState(0);
  const [editStatus, setEditStatus] = useState("pending");
  const [savingSub, setSavingSub] = useState(false);
  const [editSubError, setEditSubError] = useState<string | null>(null);
  const editTaskEditorRef = useRef<TaskEditorHandle | null>(null);

  // Recurring templates linked to the selected Operation — the "Recurring"
  // section below Subtasks. Objectives don't have this section (kind check
  // at render time); the fetch itself is harmless either way.
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringTaskTemplate[]>([]);
  const [openTemplate, setOpenTemplate] = useState<RecurringTaskTemplate | null>(null);
  const [recurringLoading, setRecurringLoading] = useState(false);


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

  // Objective tab: load the Operations that support these objectives, so each
  // objective can show its linked operations (read-only; edited in Operations).
  useEffect(() => {
    if (kind !== "objective") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects?mine=true&kind=operation", { cache: "no-store" });
        if (res.ok && !cancelled) {
          const d = await res.json();
          setLinkedOperations(d.projects ?? []);
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
    // Order within each level (parents among parents, children within a parent):
    // a manual drag order (sort_order) wins when set; otherwise by target date
    // ascending (undated last); created_at breaks remaining ties.
    const rank = (a: Project, b: Project) => {
      const sa = a.sort_order, sb = b.sort_order;
      if (sa != null && sb != null && sa !== sb) return sa - sb;
      if (sa != null && sb == null) return -1;
      if (sa == null && sb != null) return 1;
      const ta = a.target_date ?? "", tb = b.target_date ?? "";
      if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
      if (ta && !tb) return -1;
      if (!ta && tb) return 1;
      return (a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1;
    };
    for (const list of map.values()) list.sort(rank);
    return map;
  }, [projects]);

  const rootProjects = childrenByParent.get("__root__") ?? [];

  // Left-list search: keep a root if it or any descendant matches by name.
  const displayRoots = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return rootProjects;
    const matches = (p: Project): boolean =>
      p.name.toLowerCase().includes(q) || (childrenByParent.get(p.id) ?? []).some(matches);
    return rootProjects.filter(matches);
  }, [rootProjects, listSearch, childrenByParent]);

  // Candidates for "Nested Under" when editing an existing Objective: every
  // other Objective except itself and its own descendants — picking a
  // descendant as the new parent would create a loop in the tree.
  const nestableParentOptions = useMemo(() => {
    if (!selectedProject) return [];
    const descendantIds = new Set<string>();
    const queue = [selectedProject.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const child of childrenByParent.get(current) ?? []) {
        if (!descendantIds.has(child.id)) {
          descendantIds.add(child.id);
          queue.push(child.id);
        }
      }
    }
    return projects.filter((p) => p.id !== selectedProject.id && !descendantIds.has(p.id));
  }, [selectedProject, projects, childrenByParent]);

  // Drag-to-reorder top-level items. Reorders the visible root list, then
  // persists the new order (sets sort_order = index), which wins over the
  // date sort until changed again.
  const handleReorderSiblings = async (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    const dragged = projects.find((p) => p.id === draggedId);
    const target = projects.find((p) => p.id === targetId);
    if (!dragged || !target) return;
    // Only reorder within the same level (same parent) — dropping onto a node
    // in a different group is ignored.
    if ((dragged.parent_project_id ?? null) !== (target.parent_project_id ?? null)) return;
    const parentKey = dragged.parent_project_id ?? "__root__";
    const ids = (childrenByParent.get(parentKey) ?? []).map((p) => p.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, draggedId);
    const orderById = new Map(ids.map((id, idx) => [id, idx]));
    // Optimistic: renumber this sibling group so the list holds its order immediately.
    setProjects((prev) => prev.map((p) =>
      orderById.has(p.id) ? { ...p, sort_order: orderById.get(p.id)! } : p
    ));
    try {
      await fetch("/api/projects/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    } catch {
      void fetchProjects();
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleOps = (id: string) => {
    setExpandedOpsIds((prev) => {
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
    setEditStartDate(selectedProject.start_date ?? "");
    setEditProjectStatus(selectedProject.status ?? "active");
    setEditLinkedObjectiveId(selectedProject.linked_objective_id ?? "");
    setEditParentId(selectedProject.parent_project_id ?? "");
    setEditVaIds([]);
    setEditNotice(null);
    setSubtasks([]);
    setOutputSubtasks([]);
    setEditingOutputId(null);
    setAddFormKey((k) => k + 1);
    setEditingSubId(null);
    setShowDetails(false);
    setShowVaProgress(false);
    setSubtaskView("checklist");
    setShowAddSubtask(false);
    setRecurringTemplates([]);
    void fetchSubtasks(selectedProject.id);
    void fetchOutputSubtasks(selectedProject.id);
    void fetchVaAccess(selectedProject.id);
    void fetchRecurringForProject(selectedProject.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id]);

  // Trash, not a hard delete: the row keeps its history and can be restored
  // from the trash filter, same as every other task in the app. Someone adding
  // a subtask to the wrong Operation had no way to take it back off.
  const handleDeleteSubtask = useCallback(
    async (subtaskId: number, taskName: string) => {
      if (!confirm(`Move "${taskName}" to trash? You can restore it from the trash filter.`)) return;
      setDeletingSubId(subtaskId);
      try {
        const res = await fetch(`/api/assigned-tasks/${subtaskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deleted_at: new Date().toISOString() }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        setSubtasks((prev) => prev.filter((t) => t.id !== subtaskId));
        setEditingSubId(null);
      } catch (error) {
        setEditSubError(error instanceof Error ? error.message : "Failed to delete this subtask.");
      } finally {
        setDeletingSubId(null);
      }
    },
    []
  );

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

  const handleDeleteOutputSubtask = useCallback(
    async (taskId: number, taskName: string) => {
      if (!confirm(`Move "${taskName}" to trash? You can restore it from the trash filter.`)) return;
      setDeletingOutputId(taskId);
      try {
        const res = await fetch(`/api/fixed-pay-tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deleted_at: new Date().toISOString() }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        setOutputSubtasks((prev) => prev.filter((t) => t.id !== taskId));
        setEditingOutputId(null);
      } catch (error) {
        setEditSubError(error instanceof Error ? error.message : "Failed to delete this subtask.");
      } finally {
        setDeletingOutputId(null);
      }
    },
    []
  );

  const fetchOutputSubtasks = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/fixed-pay-tasks?projectId=${projectId}&view=active`, { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      setOutputSubtasks((d.tasks ?? []) as OutputSubtaskRow[]);
    } catch {
      // ignore — the ordinary subtasks still render
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

  // No ?mine=true here on purpose: the API's own rule already matches "VAs see
  // only what pertains to them, admins see all" — non-admins are filtered to
  // their own assigned_to_ids server-side regardless, admins get every
  // template on this Operation. See src/app/api/recurring-task-templates/route.ts.
  const fetchRecurringForProject = useCallback(async (projectId: string) => {
    setRecurringLoading(true);
    try {
      const res = await fetch(`/api/recurring-task-templates?projectId=${projectId}`, { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      setRecurringTemplates(d.templates ?? []);
    } catch {
      // ignore
    } finally {
      setRecurringLoading(false);
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
          start_date: editStartDate || null,
          status: editProjectStatus,
          ...(kind === "objective" ? { target_date: editTargetDate || null, parent_project_id: editParentId || null } : {}),
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
              start_date: editStartDate || null,
              status: editProjectStatus,
              target_date: kind === "objective" ? (editTargetDate || null) : prev.target_date,
              linked_objective_id: kind === "operation" ? (editLinkedObjectiveId || null) : prev.linked_objective_id,
              parent_project_id: kind === "objective" ? (editParentId || null) : prev.parent_project_id,
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
          start_date: createStartDate || null,
          status: createProjectStatus,
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
      setCreateStartDate("");
      setCreateProjectStatus("active");
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

  const handleSubtaskCreated = () => {
    if (!selectedProject) return;
    setAddFormKey((k) => k + 1);
    void fetchSubtasks(selectedProject.id);
  };

  const openSubtaskEdit = (sub: SubtaskRow) => {
    setEditingSubId(sub.id);
    setEditStatus(sub.status ?? "pending");
    setEditSubError(null);
  };

  const handleSaveSubEdit = async () => {
    if (!editingSubId || !selectedProject) return;
    setSavingSub(true);
    setEditSubError(null);
    try {
      await editTaskEditorRef.current?.submit();

      const statusRes = await fetch(`/api/assigned-tasks/${editingSubId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: editStatus }),
      });
      if (!statusRes.ok) {
        const d = await statusRes.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${statusRes.status}`);
      }

      setEditingSubId(null);
      void fetchSubtasks(selectedProject.id);
    } catch (e) {
      setEditSubError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSavingSub(false);
    }
  };

  // Board View drag-and-drop: dropping a card into a column updates the task's
  // status via the same PATCH endpoint the list-view edit form uses. Optimistic
  // (Board View no longer changes status by dragging — status moves through the
  // dashboard flow only — so there's no board status-change handler here.)

  const objectiveNameById = new Map(objectiveOptions.map((o) => [o.id, o.name]));
  // Group linked operations by the objective they support, for the reverse view.
  const operationsByObjective = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const op of linkedOperations) {
      if (!op.linked_objective_id) continue;
      const list = map.get(op.linked_objective_id) ?? [];
      list.push(op);
      map.set(op.linked_objective_id, list);
    }
    return map;
  }, [linkedOperations]);

  // Load the subtasks of the Operation opened in the read-only viewer.
  useEffect(() => {
    if (!viewOperation) { setViewOperationSubtasks([]); return; }
    let cancelled = false;
    setViewOperationSubtasksLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/assigned-tasks?projectId=${viewOperation.id}`, { cache: "no-store" });
        const d = await res.json().catch(() => ({}));
        if (!cancelled) setViewOperationSubtasks((d.tasks ?? []) as SubtaskRow[]);
      } catch {
        if (!cancelled) setViewOperationSubtasks([]);
      } finally {
        if (!cancelled) setViewOperationSubtasksLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [viewOperation]);

  const openCreateForm = (parentId: string) => {
    setShowCreate(true);
    setSelectedProject(null);
    setCreateName("");
    // Nesting under a parent that already has an Account set inherits it as
    // the default — still editable, just saves re-picking the same account
    // for every child of the same Objective. Top-level creates (parentId "")
    // stay blank, same as before.
    const parent = parentId ? projects.find((p) => p.id === parentId) : null;
    setCreateAccount(parent?.account ?? "");
    setCreateDescription("");
    setCreateDetails("");
    setCreateNotes("");
    setCreateVaIds([]);
    setCreateParentId(parentId);
    setCreateTargetDate("");
    setCreateStartDate("");
    setCreateProjectStatus("active");
    setCreateLinkedObjectiveId("");
    setCreateError(null);
  };

  // Every recurring series collapsed to its one actionable occurrence before
  // any of this gets counted — otherwise a monthly template pre-generated 60
  // days ahead reads as "60 subtasks, 0 completed" instead of the 1 real
  // thing there is to do right now. See collapseRecurringSeries.
  const visibleSubtasks = useMemo(() => collapseRecurringSeries(subtasks), [subtasks]);

  // "Where they are" — per assigned VA, completed/total on the selected node's own
  // subtasks. Scoped to this node only (not nested sub-objectives): each sub-objective
  // is browsed as its own node with its own subtasks, so this already works per
  // sub-objective without needing to roll up the whole tree.
  const vaProgress = useMemo(() => {
    return editVaIds
      .map((vaId) => {
        const profile = activeProfiles.find((p) => p.id === vaId);
        const tasks = visibleSubtasks.filter(
          (t) => t.status !== "cancelled" && (t.assigned_task_assignees ?? []).some((a) => a.va_id === vaId)
        );
        const completed = tasks.filter((t) => DONE_STATUSES.has(t.status)).length;
        return { vaId, name: profile ? profileLabel(profile) : vaId, total: tasks.length, completed };
      })
      .filter((p) => p.total > 0);
  }, [editVaIds, activeProfiles, visibleSubtasks]);

  // Whole-project completion, alongside the per-VA breakdown above. Computed
  // straight off the subtask list itself rather than summed from vaProgress —
  // a subtask with more than one assignee would otherwise get counted once
  // per VA and inflate the total past the project's actual subtask count.
  const projectProgress = useMemo(() => {
    const tasks = visibleSubtasks.filter((t) => t.status !== "cancelled");
    const completed = tasks.filter((t) => DONE_STATUSES.has(t.status)).length;
    return { total: tasks.length, completed };
  }, [visibleSubtasks]);

  const renderNode = (project: Project, depth: number) => {
    const children = childrenByParent.get(project.id) ?? [];
    const isExpanded = expandedIds.has(project.id);
    return (
      <React.Fragment key={project.id}>
        <div
          onClick={() => handleSelectProject(project)}
          draggable
          onDragStart={(e) => { e.stopPropagation(); setDragId(project.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", project.id); }}
          onDragOver={(e) => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragId !== project.id) setDragOverId(project.id); }}
          onDragLeave={() => setDragOverId((cur) => (cur === project.id ? null : cur))}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const dragged = dragId || e.dataTransfer.getData("text/plain"); if (dragged) void handleReorderSiblings(dragged, project.id); setDragId(null); setDragOverId(null); }}
          onDragEnd={() => { setDragId(null); setDragOverId(null); }}
          className={`flex flex-col gap-1 px-3 py-2.5 transition-colors cursor-grab active:cursor-grabbing ${
            selectedProject?.id === project.id ? "bg-parchment" : "hover:bg-cream"
          } ${dragOverId === project.id ? "border-t-2 border-terracotta" : ""} ${dragId === project.id ? "opacity-50" : ""}`}
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
              {project.status && project.status !== "active" && PROJECT_STATUS_BY_VALUE.has(project.status) && (
                <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${PROJECT_STATUS_BY_VALUE.get(project.status)!.cls}`}>
                  {PROJECT_STATUS_BY_VALUE.get(project.status)!.label}
                </span>
              )}
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
          {kind === "objective" && (operationsByObjective.get(project.id)?.length ?? 0) > 0 && (() => {
            const ops = operationsByObjective.get(project.id)!;
            const opsOpen = expandedOpsIds.has(project.id);
            return (
              <div className="flex flex-col gap-1">
                {/* Collapsed by default so the row stays calm; expand to see the
                    linked operations. */}
                <button
                  type="button"
                  draggable={false}
                  onClick={(e) => { e.stopPropagation(); toggleOps(project.id); }}
                  className="w-fit inline-flex items-center gap-1 text-[10px] font-semibold text-slate-blue hover:text-espresso transition-colors cursor-pointer"
                >
                  <span className="text-[8px] w-2">{opsOpen ? "▼" : "▶"}</span>
                  {ops.length} operation{ops.length === 1 ? "" : "s"}
                </button>
                {opsOpen && (
                  <div className="flex flex-wrap items-center gap-1 pl-3">
                    {ops.map((op) => (
                      <button
                        key={op.id}
                        type="button"
                        draggable={false}
                        onClick={(e) => { e.stopPropagation(); setViewOperation(op); }}
                        title="View operation details (read-only) — edit in Operations"
                        className="text-[10px] font-semibold px-2 py-[2px] rounded-full border bg-slate-blue-soft text-slate-blue border-slate-blue/20 w-fit inline-flex items-center gap-1 hover:bg-slate-blue/20 transition-colors cursor-pointer"
                      >
                        <span className="opacity-60 uppercase tracking-wide text-[8px]">Op</span>
                        {op.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          {project.description && (
            <p className="text-[11px] text-stone/80 truncate">{project.description}</p>
          )}
          <p className="text-[10px] text-stone/60">{formatDate(project.created_at)}</p>
        </div>
        {isExpanded && children.map((child) => renderNode(child, depth + 1))}
      </React.Fragment>
    );
  };

  // Subtasks card — shared between the normal detail layout (List View, narrow
  // column) and the Board View full-width takeover below, so the two never drift.
  // Recurring templates linked to this node. Objectives show it too now: a
  // template pointed at an Objective was being saved correctly and then never
  // shown anywhere, because only the Operation view ever fetched or rendered
  // this list.
  const renderRecurringCard = () => (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Recurring</h3>
      </div>
      {recurringLoading ? (
        <p className="text-[12px] text-stone">Loading…</p>
      ) : recurringTemplates.length === 0 ? (
        <p className="text-[12px] text-stone/70">
          No recurring templates linked yet. Tick &ldquo;Save as a recurring template&rdquo; on a task
          here, or point a template at this {kind === "objective" ? "Objective" : "Operation"}.
        </p>
      ) : (
        <div className="space-y-1.5">
          {recurringTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => setOpenTemplate(template)}
              className="flex w-full flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white text-left transition-colors hover:bg-cream"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] font-semibold text-espresso leading-tight">
                  {template.title || template.task_name || "Untitled template"}
                </span>
                <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${
                  template.is_active
                    ? "bg-sage-soft text-sage border-sage/20"
                    : "bg-stone/10 text-stone border-stone/20"
                }`}>
                  {template.is_active ? "Active" : "Paused"}
                </span>
              </div>
              <div className="text-[11px] text-stone/80">
                {RECURRENCE_LABEL[template.recurrence_type] ?? template.recurrence_type} · Starts {formatDate(template.start_date)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const renderSubtasksCard = () => {
    if (!selectedProject) return null;
    return (
      <div className="rounded-xl border border-sand bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowSubtasks((v) => !v)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <span className="text-amber text-[10px] w-3 shrink-0">{showSubtasks ? "▼" : "▶"}</span>
            <h4 className="text-xs font-bold text-amber uppercase tracking-wide">Subtask Checklist</h4>
          </button>
          {showSubtasks && (
          <div className="flex items-center gap-2">
            {subtasksLoading && (
              <span className="text-[11px] text-stone">Loading...</span>
            )}
            {/* One uniform button row: same shape/size for every control. The
                Checklist toggle and Add Subtask share the amber accent (the
                "Subtask Checklist" theme); List/Board use the sage accent. */}
            <div className="flex items-center gap-1">
              {([
                ["checklist", "Checklist", "amber"],
                ["list", "List View", "sage"],
                ["board", "Board View", "sage"],
              ] as const).map(([v, label, accent]) => {
                const active = subtaskView === v;
                const cls = active
                  ? (accent === "amber" ? "bg-amber text-white" : "bg-sage text-white")
                  : (accent === "amber" ? "bg-amber-soft text-amber hover:bg-amber-soft/70" : "bg-stone/10 text-stone hover:bg-stone/20");
                return (
                  <button
                    key={v}
                    onClick={() => setSubtaskView(v)}
                    className={`px-3 py-1 rounded-lg text-[10px] font-semibold transition-colors ${cls}`}
                  >
                    {label}
                  </button>
                );
              })}
              {/* Add Subtask at the very end of the same row — amber, toggles
                  the create form at the bottom. */}
              <button
                onClick={() => setShowAddSubtask((v) => !v)}
                className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-amber text-white hover:bg-amber/90 transition-colors"
              >
                {showAddSubtask ? "Cancel" : "+ Add Subtask"}
              </button>
            </div>
          </div>
          )}
        </div>

        {showSubtasks && (
        <>
        {!subtasksLoading && subtaskView === "list" && visibleSubtasks.length === 0 && (
          <p className="text-[12px] text-stone/70">No subtasks yet. Add one below.</p>
        )}

        {subtaskView === "board" && (
          <SubtaskBoardView
            subtasks={visibleSubtasks}
            editingSubId={editingSubId}
            onOpenEdit={openSubtaskEdit}
            formatDate={formatDate}
            StatusBadge={StatusBadge}
            activeProfiles={activeProfiles}
          />
        )}

        {subtaskView === "board" && editingSubId != null && (() => {
          const sub = subtasks.find((s) => s.id === editingSubId);
          if (!sub) return null;
          return (
            <div className="space-y-3 rounded-lg border border-sand bg-parchment p-3">
              <TaskEditor
                // Sub id in the key — this is the one Board View edit
                // instance (a fixed JSX position, not one per card, unlike
                // the list-view edit form below), so without a key that
                // changes with the subtask, switching which card is being
                // edited (clicking a different one without cancelling first)
                // doesn't remount TaskEditor: its useState-seeded fields keep
                // the previous subtask's values while editingTaskId silently
                // moves to the new one, and Save would write the old data
                // onto the new subtask's id.
                key={`board-edit-${sub.id}`}
                ref={editTaskEditorRef}
                mode="time_based"
                editingTaskId={sub.id}
                initialTask={sub as unknown as Record<string, unknown>}
                currentUserId={currentUserId}
                isAdminOrManager={isAdmin}
                teamMembers={activeProfiles}
                lockedProjectId={selectedProject.id}
                hideFooter
                onCancel={() => setEditingSubId(null)}
                onSaved={() => {}}
              />

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
                  Status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>

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
          );
        })()}

        {subtaskView === "list" && visibleSubtasks.length > 0 && (() => {
          const SIZE = 8;
          const pages = Math.max(1, Math.ceil(visibleSubtasks.length / SIZE));
          const page = Math.min(subtaskPage, pages - 1);
          const slice = visibleSubtasks.slice(page * SIZE, page * SIZE + SIZE);
          return (
          <>
          <div className="space-y-1.5">
            {slice.map((sub) => {
              // Shared with SubtaskBoardView.tsx (src/lib/subtaskDisplay.ts) —
              // keep the two views in sync instead of drifting.
              const names = subtaskAssigneeNames(sub.assigned_task_assignees, activeProfiles);
              const isEditing = editingSubId === sub.id;
              const isViewing = viewingSubId === sub.id;

              return (
                <div key={sub.id} className="space-y-1">
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-sand bg-white hover:bg-cream transition-colors">
                    <StatusBadge status={sub.status} />
                    <button
                      type="button"
                      onClick={() => setViewingSubId(isViewing ? null : sub.id)}
                      className="flex-1 text-left text-[13px] font-semibold text-espresso leading-tight truncate hover:text-terracotta transition-colors"
                    >
                      {sub.task_name}
                    </button>
                    {(sub.project || sub.category) && (
                      <span className="text-[11px] text-walnut shrink-0 hidden sm:block">
                        {sub.project ?? sub.category}
                      </span>
                    )}
                    {names && (
                      <span className="text-[11px] text-walnut shrink-0 hidden sm:block">
                        {names}
                      </span>
                    )}
                    {sub.account && (
                      <span className="text-[11px] text-walnut shrink-0 hidden md:block">
                        {sub.account}
                      </span>
                    )}
                    {sub.due_date && (
                      <span className="text-[11px] text-walnut shrink-0 hidden md:block">
                        Due: {formatDate(sub.due_date)}
                      </span>
                    )}
                    {sub.created_at && (
                      <span className="text-[11px] text-bark shrink-0 hidden lg:block">
                        {sub.created_by_profile?.full_name || sub.created_by_profile?.username
                          ? `${sub.created_by_profile.full_name || sub.created_by_profile.username} · `
                          : ""}
                        {formatDate(sub.created_at)}
                      </span>
                    )}
                    {sub.pay_type && (
                      <span className="text-[11px] text-walnut capitalize shrink-0 hidden lg:block">
                        {sub.pay_type.replace(/_/g, " ")}
                      </span>
                    )}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setViewingSubId(isViewing ? null : sub.id)}
                        className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-stone/15 text-espresso hover:bg-stone/25 transition-colors"
                      >
                        {isViewing ? "Hide" : "View"}
                      </button>
                      <button
                        onClick={() => (isEditing ? setEditingSubId(null) : openSubtaskEdit(sub))}
                        className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-sage text-white hover:bg-sage/90 transition-colors"
                      >
                        {isEditing ? "Cancel" : "Edit"}
                      </button>
                    </div>
                  </div>

                  {/* Read-only detail — all fields, blank shows "--", with an
                      optional Edit Task. */}
                  {isViewing && !isEditing && (
                    <div className="ml-3 rounded-lg border border-sand overflow-hidden text-[12px]">
                      {([
                        ["Status", sub.status?.replace(/_/g, " ")],
                        ["Category", sub.category],
                        ["Project", sub.project],
                        ["Account", sub.account],
                        ["Pay Type", sub.pay_type?.replace(/_/g, " ")],
                        ["Staff Involved", names],
                        ["Assigned By", sub.assigned_by ? (activeProfiles.find((a) => a.id === sub.assigned_by) ? profileLabel(activeProfiles.find((a) => a.id === sub.assigned_by)!) : null) : null],
                        ["Due Date", sub.due_date ? formatDate(sub.due_date) : null],
                        ["Client Detail", sub.task_detail],
                        ["Notes", sub.task_notes],
                        ["Instructions", sub.instructions],
                        ["Review Required", sub.review_required ? "Yes" : "No"],
                        ["Created By", sub.created_by_profile?.full_name || sub.created_by_profile?.username],
                        ["Created", sub.created_at ? formatDate(sub.created_at) : null],
                      ] as [string, string | null | undefined][]).map(([label, value]) => (
                        <div key={label} className="flex border-b border-sand/60 last:border-0">
                          <div className="w-32 shrink-0 bg-parchment/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-walnut">{label}</div>
                          <div className={`flex-1 px-3 py-2 whitespace-pre-wrap ${value ? "text-espresso" : "text-stone/50"}`}>{value || "--"}</div>
                        </div>
                      ))}
                      <div className="flex justify-end p-2 border-t border-sand/60">
                        <button
                          onClick={() => { setViewingSubId(null); openSubtaskEdit(sub); }}
                          className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-sage text-white hover:bg-sage/90 transition-colors"
                        >
                          Edit Task
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Inline edit form */}
                  {isEditing && (
                    <div className="ml-3 space-y-3 rounded-lg border border-sand bg-parchment p-3">
                      <TaskEditor
                        ref={editTaskEditorRef}
                        mode="time_based"
                        editingTaskId={sub.id}
                        initialTask={sub as unknown as Record<string, unknown>}
                        currentUserId={currentUserId}
                        isAdminOrManager={isAdmin}
                        teamMembers={activeProfiles}
                        lockedProjectId={selectedProject.id}
                        hideFooter
                        onCancel={() => setEditingSubId(null)}
                        onSaved={() => {}}
                      />

                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
                          Status
                        </label>
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value)}
                          className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white"
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                          ))}
                        </select>
                      </div>

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
                        <button
                          onClick={() => void handleDeleteSubtask(sub.id, sub.task_name)}
                          disabled={deletingSubId === sub.id}
                          className="ml-auto px-3 py-1 rounded-lg border border-red-200 text-[11px] font-semibold text-red-600 hover:border-red-400 transition-colors disabled:opacity-50"
                        >
                          {deletingSubId === sub.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between pt-2 text-[11px] text-bark">
              <button disabled={page === 0} onClick={() => setSubtaskPage(page - 1)} className="px-2 py-0.5 rounded hover:bg-parchment disabled:opacity-40">‹ Prev</button>
              <span className="text-stone">{page + 1} / {pages}</span>
              <button disabled={page >= pages - 1} onClick={() => setSubtaskPage(page + 1)} className="px-2 py-0.5 rounded hover:bg-parchment disabled:opacity-40">Next ›</button>
            </div>
          )}
          </>
          );
        })()}

        {subtaskView === "list" && outputSubtasks.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">Output Based</p>
            {outputSubtasks.map((task) => {
              const isEditing = editingOutputId === task.id;
              const who = activeProfiles.find((p) => p.id === task.assigned_to);
              return (
                <div key={task.id} className="space-y-1">
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-sand bg-white hover:bg-cream transition-colors">
                    <StatusBadge status={task.status} />
                    <span className="flex-1 text-[13px] font-semibold text-espresso leading-tight truncate">
                      {task.task_name}
                    </span>
                    {who && (
                      <span className="text-[11px] text-stone shrink-0 hidden sm:block">
                        {who.full_name || who.username}
                      </span>
                    )}
                    {task.account && (
                      <span className="text-[11px] text-stone shrink-0 hidden md:block">{task.account}</span>
                    )}
                    {task.start_date && (
                      <span className="text-[11px] text-stone shrink-0 hidden md:block">
                        Starts: {formatDate(task.start_date)}
                      </span>
                    )}
                    <span className="text-[11px] text-stone capitalize shrink-0 hidden lg:block">output based</span>
                    <button
                      onClick={() => setEditingOutputId(isEditing ? null : task.id)}
                      className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors shrink-0"
                    >
                      {isEditing ? "Cancel" : "Edit"}
                    </button>
                  </div>

                  {isEditing && (
                    <div className="ml-3 space-y-3 rounded-lg border border-sand bg-parchment p-3">
                      <TaskEditor
                        mode="output_based"
                        editingTaskId={task.id}
                        initialTask={task as unknown as Record<string, unknown>}
                        currentUserId={currentUserId}
                        isAdminOrManager={isAdmin}
                        teamMembers={activeProfiles}
                        lockedProjectId={selectedProject.id}
                        onCancel={() => setEditingOutputId(null)}
                        onSaved={() => {
                          setEditingOutputId(null);
                          void fetchOutputSubtasks(selectedProject.id);
                        }}
                      />
                      <div className="flex">
                        <button
                          onClick={() => void handleDeleteOutputSubtask(task.id, task.task_name)}
                          disabled={deletingOutputId === task.id}
                          className="ml-auto px-3 py-1 rounded-lg border border-red-200 text-[11px] font-semibold text-red-600 hover:border-red-400 transition-colors disabled:opacity-50"
                        >
                          {deletingOutputId === task.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Checklist view — checkbox list for this project AND all its nested
            children, in the same window as List/Board. */}
        {subtaskView === "checklist" && (
          <ObjectiveOverview
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            projects={projects}
            onSelect={handleSelectProject}
            scopeId={selectedProject.id}
            kindLabel={kindLabel as "Objective" | "Operation"}
            refreshSignal={dashboardRefresh}
            showOnly="subtasks"
          />
        )}

        {/* Add Subtask form — toggled by the "+ Add Subtask" button in the
            top-right button row; renders here at the very end when open. */}
        {showAddSubtask && (
          <div className="border-t border-sand pt-4 space-y-3">
            <>
              <div className="flex items-center gap-1 rounded-lg border border-sand bg-parchment/40 p-1 w-fit">
                {([["time_based", "Time-based"], ["output_based", "Output-based"]] as const).map(([m, label]) => (
                  <button key={m} type="button" onClick={() => setAddSubtaskMode(m)}
                    className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-colors ${addSubtaskMode === m ? "bg-white text-espresso shadow-sm" : "text-walnut hover:text-espresso"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <TaskEditor
                key={`end-${addFormKey}-${addSubtaskMode}`}
                mode={addSubtaskMode}
                editingTaskId={null}
                initialTask={{ account: selectedProject.account ?? null }}
                currentUserId={currentUserId}
                isAdminOrManager={isAdmin}
                teamMembers={activeProfiles}
                lockedProjectId={selectedProject.id}
                onCancel={() => { setAddFormKey((k) => k + 1); setShowAddSubtask(false); }}
                onSaved={() => { handleSubtaskCreated(); setShowAddSubtask(false); setDashboardRefresh((k) => k + 1); }}
              />
            </>
          </div>
        )}
        </>
        )}
      </div>
    );
  };

  // The full Add-Subtask form (TaskEditor), pulled out so the scoped dashboard
  // view can offer real subtask creation (category, assignee, detail, …) rather
  // than the dashboard's name-only quick-add.
  const renderAddSubtaskForm = () => {
    if (!selectedProject) return null;
    return (
      <div className="rounded-xl border border-sand bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">Add Subtask</p>
          <button
            onClick={() => setShowAddSubtask((v) => !v)}
            className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-sage text-white hover:bg-sage/90 transition-colors"
          >
            {showAddSubtask ? "Cancel" : "+ Add Subtask"}
          </button>
        </div>
        {showAddSubtask && (
          <>
            <div className="flex items-center gap-1 rounded-lg border border-sand bg-parchment/40 p-1 w-fit">
              {([
                ["time_based", "Time-based"],
                ["output_based", "Output-based"],
              ] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setAddSubtaskMode(m)}
                  className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-colors ${
                    addSubtaskMode === m ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <TaskEditor
              key={`${addFormKey}-${addSubtaskMode}`}
              mode={addSubtaskMode}
              editingTaskId={null}
              initialTask={{ account: selectedProject.account ?? null }}
              currentUserId={currentUserId}
              isAdminOrManager={isAdmin}
              teamMembers={activeProfiles}
              lockedProjectId={selectedProject.id}
              onCancel={() => { setAddFormKey((k) => k + 1); setShowAddSubtask(false); }}
              onSaved={() => {
                if (addSubtaskMode === "output_based" && selectedProject) {
                  void fetchOutputSubtasks(selectedProject.id);
                } else {
                  handleSubtaskCreated();
                }
                setShowAddSubtask(false);
                setDashboardRefresh((k) => k + 1);
              }}
            />
          </>
        )}
      </div>
    );
  };

  const templateEditor = openTemplate ? (
    <RecurringTemplatePanel
      key={openTemplate.id}
      template={openTemplate}
      currentUserId={currentUserId}
      teamMembers={activeProfiles.map((p) => ({
        id: p.id,
        full_name: p.full_name ?? "",
        username: p.username ?? "",
      }))}
      isAdminOrManager={isAdmin}
      onCancel={() => setOpenTemplate(null)}
      onSaved={() => {
        setOpenTemplate(null);
        if (selectedProject) void fetchRecurringForProject(selectedProject.id);
      }}
    />
  ) : null;

  // Linking a task to this Operation usually happens somewhere else — the
  // Assignment page, the calendar, another tab — so the subtask list is stale
  // the moment you come back to it. Refetch on return rather than making
  // someone reload the page to see work they just linked here.
  useEffect(() => {
    if (!selectedProject) return;
    const projectId = selectedProject.id;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void fetchSubtasks(projectId);
      void fetchOutputSubtasks(projectId);
      void fetchRecurringForProject(projectId);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [selectedProject, fetchSubtasks, fetchOutputSubtasks, fetchRecurringForProject]);

  // Board View is a full-width takeover (Figma correction) — sidebar and the
  // Objective details/Where They Are panel hide entirely while it's active.
  const isBoardTakeover = Boolean(selectedProject) && !showCreate && subtaskView === "board";

  return (
    <div className="space-y-4">
      {templateEditor}
      {!isBoardTakeover && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <button
                type="button"
                onClick={() => { setSelectedProject(null); setShowCreate(false); }}
                title={`Back to the ${kindLabel.toLowerCase()} overview`}
                className="group inline-flex items-center gap-1.5 cursor-pointer"
              >
                <svg className="h-4 w-4 text-bark group-hover:text-terracotta transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                <span className="text-sm font-bold text-espresso group-hover:text-terracotta underline decoration-dotted decoration-stone/50 underline-offset-4 group-hover:decoration-terracotta transition-colors">
                  My {kindLabel}s
                </span>
              </button>
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
          <input
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder={`Search ${kindLabel.toLowerCase()}s…`}
            className="w-full max-w-xs rounded-lg border border-sand px-3 py-1.5 text-[12px] text-espresso outline-none focus:border-terracotta bg-white"
          />
        </div>
      )}

      {selectedProject && subtaskView === "board" && !showCreate ? (
        /* ── Board View full-width takeover (Figma correction): sidebar and the
             Objective details/Where They Are panel hide entirely; just a back
             button + the board at full width. ──────────────────────────────── */
        <div className="space-y-4">
          <button
            onClick={() => setSubtaskView("checklist")}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-espresso hover:text-terracotta transition-colors cursor-pointer"
          >
            <span aria-hidden="true">←</span> {selectedProject.name}
          </button>
          {renderSubtasksCard()}
        </div>
      ) : (
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
              {displayRoots.map((project) => renderNode(project, 0))}
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={createStartDate}
                    onChange={(e) => setCreateStartDate(e.target.value)}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                    Status
                  </label>
                  <select
                    value={createProjectStatus}
                    onChange={(e) => setCreateProjectStatus(e.target.value)}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                  >
                    {PROJECT_STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
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
                    {toHierOptions(objectiveOptions).map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
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
              {/* Where They Are card */}
              {vaProgress.length > 0 && (
                <div className="rounded-xl border border-sand bg-white p-5 shadow-sm space-y-3">
                  {/* Whole-project total — always visible, not part of the
                      collapsible section below. This is the number someone
                      wants at a glance; the per-VA breakdown is the detail
                      they open up only when they want it. */}
                  {projectProgress.total > 0 && (
                    <div className="space-y-1.5 pb-3 border-b border-sand">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-bold text-espresso">Overall Progress</span>
                        <span className="text-[11px] font-semibold text-walnut shrink-0">
                          {projectProgress.completed} of {projectProgress.total} completed · {Math.round((projectProgress.completed / projectProgress.total) * 100)}%
                        </span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-parchment">
                        <div
                          className="h-full rounded-full bg-sage transition-all"
                          style={{ width: `${Math.round((projectProgress.completed / projectProgress.total) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Per-VA breakdown — collapsed by default to save space,
                      same chevron-toggle pattern as Assignment's Unassigned
                      Tasks section. */}
                  <button
                    type="button"
                    onClick={() => setShowVaProgress((v) => !v)}
                    className="flex w-full cursor-pointer items-center justify-between gap-2"
                  >
                    <h4 className="text-xs font-bold text-espresso uppercase tracking-wide">Where They Are</h4>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-sand text-bark transition-colors hover:bg-parchment">
                      <svg className={`h-3.5 w-3.5 transition-transform ${showVaProgress ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </span>
                  </button>

                  {showVaProgress && (
                    <div className="space-y-3">
                      {vaProgress.map(({ vaId, name, total, completed }) => {
                        const pct = Math.round((completed / total) * 100);
                        return (
                          <div key={vaId} className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[12px] font-semibold text-espresso truncate">{name}</span>
                              <span className="text-[11px] text-walnut shrink-0">
                                {completed} of {total} completed · {pct}%
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-parchment">
                              <div className="h-full rounded-full bg-sage transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Breadcrumb — back to the overview and up the parent chain. */}
              {(() => {
                const projById = new Map(projects.map((p) => [p.id, p]));
                const chain: Project[] = [];
                let pid = selectedProject.parent_project_id;
                while (pid) { const p = projById.get(pid); if (!p) break; chain.unshift(p); pid = p.parent_project_id; }
                return (
                  <div className="flex items-center gap-1 text-[11px] text-bark flex-wrap">
                    <button type="button" onClick={() => { setSelectedProject(null); setShowCreate(false); }} className="font-semibold hover:text-espresso transition-colors">All {kindLabel}s</button>
                    {chain.map((a) => (
                      <React.Fragment key={a.id}>
                        <span aria-hidden>›</span>
                        <button type="button" onClick={() => handleSelectProject(a)} className="hover:text-espresso transition-colors truncate max-w-[160px]">{a.name}</button>
                      </React.Fragment>
                    ))}
                    <span aria-hidden>›</span>
                    <span className="text-espresso font-semibold truncate max-w-[200px]">{selectedProject.name}</span>
                  </div>
                );
              })()}

              {/* Objective name + lighter default view (Figma reference) — Details
                  form is opened on demand instead of shown by default. */}
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <h3 className="text-base font-bold text-espresso truncate">{selectedProject.name}</h3>
                <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border shrink-0 ${
                  selectedProject.is_active
                    ? "bg-sage-soft text-sage border-sage/20"
                    : "bg-stone/10 text-stone border-stone/20"
                }`}>
                  {selectedProject.is_active ? "Active" : "Inactive"}
                </span>
              </div>

              {/* Tabs — one shared box for everything inside a project. */}
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-sand bg-parchment/40 p-1">
                {([
                  ["board", "Message Board"],
                  ["details", `${kindLabel} Details`],
                  ["subtasks", "Subtasks"],
                  ["overview", `Sub-${kindLabel.toLowerCase()}s`],
                  ["docs", "Docs & Files"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setScopedTab(key); if (key === "details") setShowDetails(false); }}
                    className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                      scopedTab === key ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Details tab content */}
              <div className={scopedTab === "details" ? "rounded-xl border border-sand bg-white p-5 shadow-sm space-y-4 h-[560px] overflow-y-auto" : "hidden"}>
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[13px] font-bold text-espresso">{kindLabel} Details</h4>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowDetails((v) => !v)}
                      className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-sage text-white hover:bg-sage/90 transition-colors"
                    >
                      {showDetails ? "View" : "Edit"}
                    </button>
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

                {!showDetails && (
                  <div className="rounded-lg border border-sand overflow-hidden text-[12px]">
                    {([
                      ["Name", selectedProject.name],
                      ["Status", PROJECT_STATUS_BY_VALUE.get(selectedProject.status ?? "")?.label ?? selectedProject.status],
                      ["Active", selectedProject.is_active ? "Active" : "Inactive"],
                      ["Account", selectedProject.account],
                      ["Start Date", selectedProject.start_date ? formatDate(selectedProject.start_date) : null],
                      ...((kind === "objective" ? [
                        ["Target Date", selectedProject.target_date ? formatDate(selectedProject.target_date) : null],
                        ["Nested Under", selectedProject.parent_project_id ? (projects.find((p) => p.id === selectedProject.parent_project_id)?.name ?? null) : "Top-level"],
                      ] : []) as [string, string | null][]),
                      ...((kind === "operation" ? [
                        ["Supports Objective", selectedProject.linked_objective_id ? (objectiveNameById.get(selectedProject.linked_objective_id) ?? null) : null],
                      ] : []) as [string, string | null][]),
                      ["Description", selectedProject.description],
                      ["Details", selectedProject.details],
                      ["Notes", selectedProject.notes],
                      ["Staff Involved", editVaIds.length > 0 ? editVaIds.map((id) => { const p = activeProfiles.find((a) => a.id === id); return p ? profileLabel(p) : null; }).filter(Boolean).join(", ") : null],
                      ["Created", selectedProject.created_at ? formatDate(selectedProject.created_at) : null],
                    ] as [string, string | null | undefined][])
                      .map(([label, value]) => (
                        <div key={label} className="flex border-b border-sand/60 last:border-0">
                          <div className="w-32 shrink-0 bg-parchment/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-walnut">{label}</div>
                          <div className={`flex-1 px-3 py-2 whitespace-pre-wrap ${value ? "text-espresso" : "text-stone/50"}`}>{value || "--"}</div>
                        </div>
                      ))}
                  </div>
                )}

                {showDetails && (
                <>
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

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={editStartDate}
                      onChange={(e) => setEditStartDate(e.target.value)}
                      className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                      Status
                    </label>
                    <select
                      value={editProjectStatus}
                      onChange={(e) => setEditProjectStatus(e.target.value)}
                      className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                    >
                      {PROJECT_STATUS_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
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

                {kind === "objective" && (
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                      Nested Under
                    </label>
                    <select
                      value={editParentId}
                      onChange={(e) => setEditParentId(e.target.value)}
                      className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                    >
                      <option value="">— Top-level —</option>
                      {toHierOptions(nestableParentOptions).map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
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
                </>
                )}
              </div>

              {/* Subtasks tab — the operation's OWN subtasks: the original card
                  with List View / Board View + Edit + Create. */}
              {scopedTab === "subtasks" && renderSubtasksCard()}

              {/* Message Board / Checklist / Sub-items / Docs via the dashboard.
                  The Checklist is the checkbox list (this project + all children)
                  in a fixed-height box with collapsed groups + pagination. */}
              <div className={(scopedTab === "board" || scopedTab === "overview" || scopedTab === "docs") ? "" : "hidden"}>
                <ObjectiveOverview
            currentUserId={currentUserId}
            isAdmin={isAdmin}
                  projects={projects}
                  onSelect={handleSelectProject}
                  scopeId={selectedProject.id}
                  kindLabel={kindLabel as "Objective" | "Operation"}
                  refreshSignal={dashboardRefresh}
                  showOnly={scopedTab === "overview" ? "overview" : scopedTab === "docs" ? "docs" : "board"}
                  onEditProject={(p) => { handleSelectProject(p); setScopedTab("details"); setShowDetails(true); }}
                />
              </div>
            </div>
          )}

          {/* Nothing selected: the dashboard overview, tab-based (one big box)
              rather than a 4-card grid so each section has room. */}
          {!selectedProject && !showCreate && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-sand bg-parchment/40 p-1">
                {([
                  ["board", "Message Board"],
                  ["overview", `${kindLabel} Overview`],
                  ["subtasks", "Subtasks"],
                  ["docs", "Docs & Files"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setLandingTab(key)}
                    className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                      landingTab === key ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <ObjectiveOverview
            currentUserId={currentUserId}
            isAdmin={isAdmin}
                projects={projects}
                onSelect={handleSelectProject}
                kindLabel={kindLabel as "Objective" | "Operation"}
                showOnly={landingTab}
                onEditProject={(p) => { handleSelectProject(p); setScopedTab("details"); setShowDetails(true); }}
               
              />
            </div>
          )}
        </div>
      </div>
      )}

      {viewOperation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onClick={() => setViewOperation(null)}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-sand bg-white p-5 shadow-lg space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full border bg-slate-blue-soft text-slate-blue border-slate-blue/20 shrink-0">
                  Operation
                </span>
                <h3 className="text-sm font-bold text-espresso">{viewOperation.name}</h3>
              </div>
              <button
                onClick={() => setViewOperation(null)}
                className="text-bark hover:text-espresso text-xl leading-none cursor-pointer shrink-0"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="text-[11px] text-stone">Read-only — edit this operation in the Operations tab.</p>

            <div className="flex flex-wrap gap-1.5">
              {viewOperation.status && PROJECT_STATUS_BY_VALUE.has(viewOperation.status) && (
                <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${PROJECT_STATUS_BY_VALUE.get(viewOperation.status)!.cls}`}>
                  {PROJECT_STATUS_BY_VALUE.get(viewOperation.status)!.label}
                </span>
              )}
              {viewOperation.account && (
                <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full border bg-parchment text-walnut border-sand">
                  {viewOperation.account}
                </span>
              )}
              {viewOperation.start_date && (
                <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full border bg-parchment text-walnut border-sand">
                  Start: {formatDate(viewOperation.start_date)}
                </span>
              )}
              {viewOperation.target_date && (
                <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full border bg-terracotta-soft text-terracotta border-terracotta/20">
                  Target: {formatDate(viewOperation.target_date)}
                </span>
              )}
            </div>

            {[
              { label: "Description", value: viewOperation.description },
              { label: "Details", value: viewOperation.details },
              { label: "Notes", value: viewOperation.notes },
            ].some((f) => f.value) ? (
              [
                { label: "Description", value: viewOperation.description },
                { label: "Details", value: viewOperation.details },
                { label: "Notes", value: viewOperation.notes },
              ].map((f) => f.value && (
                <div key={f.label}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-walnut">{f.label}</p>
                  <p className="text-[13px] text-espresso whitespace-pre-wrap">{f.value}</p>
                </div>
              ))
            ) : (
              <p className="text-[12px] text-stone italic">No details added to this operation yet.</p>
            )}

            <div className="border-t border-sand pt-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-walnut">
                Subtasks{visibleViewOperationSubtasks.length > 0 ? ` (${visibleViewOperationSubtasks.length})` : ""}
              </p>
              {viewOperationSubtasksLoading ? (
                <p className="text-[12px] text-stone">Loading…</p>
              ) : visibleViewOperationSubtasks.length === 0 ? (
                <p className="text-[12px] text-stone italic">No subtasks.</p>
              ) : (
                <div className="space-y-1.5">
                  {visibleViewOperationSubtasks.map((st) => (
                    <div key={st.id} className="flex items-start justify-between gap-2 rounded-lg border border-sand bg-cream px-3 py-2">
                      <span className="text-[12px] text-espresso leading-tight">{st.task_name}</span>
                      <StatusBadge status={st.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
