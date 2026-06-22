"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Project } from "@/types/database";

interface ProjectsManagerProps {
  projects: Project[];
  loading: boolean;
  activeProfiles: Pick<Profile, "id" | "full_name" | "username">[];
  onRefresh: () => void;
}

interface SubtaskRow {
  id: number;
  task_name: string;
  due_date: string | null;
  created_at: string | null;
  status: string;
  pay_type?: string | null;
  category?: string | null;
  task_detail?: string | null;
  account?: string | null;
  assigned_by: string | null;
  assigned_task_assignees: Array<{
    va_id: string;
    profiles?: { id: string; full_name: string; username: string } | null;
  }>;
}

interface AccountOption {
  id: number;
  name: string;
}

interface TaskCategoryOption {
  id: number;
  category_name: string;
  is_active?: boolean;
}

interface AddSubtaskForm {
  task_name: string;
  va_id: string;
  assigned_by_id: string;
  due_date: string;
  pay_type: string;
  category: string;
  task_detail: string;
  task_notes: string;
  instructions: string;
  status: string;
}

function defaultSubtaskForm(): AddSubtaskForm {
  return {
    task_name: "",
    va_id: "",
    assigned_by_id: "",
    due_date: "",
    pay_type: "hourly",
    category: "",
    task_detail: "",
    task_notes: "",
    instructions: "",
    status: "pending",
  };
}

const HARDCODED_CATEGORIES = [
  "Task", "Message", "Meeting", "Sorting Tasks", "Collaboration", "Personal", "Break",
];

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

export default function ProjectsManager({
  projects,
  loading,
  activeProfiles,
  onRefresh,
}: ProjectsManagerProps) {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [editName, setEditName] = useState("");
  const [editAccount, setEditAccount] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDetails, setEditDetails] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editNotice, setEditNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Create project form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createAccount, setCreateAccount] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createDetails, setCreateDetails] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [taskCategories, setTaskCategories] = useState<TaskCategoryOption[]>([]);
  const [taskLibrary, setTaskLibrary] = useState<Record<number, string[]>>({});

  // Subtasks
  const [subtasks, setSubtasks] = useState<SubtaskRow[]>([]);
  const [subtasksLoading, setSubtasksLoading] = useState(false);
  const [addForm, setAddForm] = useState<AddSubtaskForm>(defaultSubtaskForm());
  const [addingSub, setAddingSub] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Edit subtask
  const [editingSubId, setEditingSubId] = useState<number | null>(null);
  const [editSubForm, setEditSubForm] = useState<AddSubtaskForm>(defaultSubtaskForm());
  const [savingSub, setSavingSub] = useState(false);
  const [editSubError, setEditSubError] = useState<string | null>(null);

  // When a project is selected, populate the edit fields and fetch subtasks
  useEffect(() => {
    if (!selectedProject) return;
    setEditName(selectedProject.name);
    setEditAccount(selectedProject.account ?? "");
    setEditDescription(selectedProject.description ?? "");
    setEditDetails(selectedProject.details ?? "");
    setEditNotes(selectedProject.notes ?? "");
    setEditNotice(null);
    setSubtasks([]);
    setAddForm(defaultSubtaskForm());
    setAddError(null);
    setEditingSubId(null);
    void fetchSubtasks(selectedProject.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id]);

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

  // Load accounts from API and task categories + task library from Supabase directly
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Accounts from API
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

        // Task categories from Supabase directly
        const supabase = createClient();
        const { data: catData } = await supabase
          .from("task_categories")
          .select("id, category_name, is_active")
          .order("sort_order", { ascending: true });

        if (!cancelled) {
          const nextCategories = (catData ?? []).filter(
            (c: TaskCategoryOption) => c.is_active !== false
          );
          setTaskCategories(nextCategories);
        }

      } catch {
        // leave dropdowns empty if fetch fails
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Task library filtered to the selected project's account
  useEffect(() => {
    const account = selectedProject?.account;
    if (!account) {
      setTaskLibrary({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: tagData } = await supabase
          .from("project_tags")
          .select("id")
          .eq("account", account)
          .eq("is_active", true);

        if (cancelled) return;
        const tagIds = (tagData ?? []).map((t: { id: number }) => t.id);
        if (tagIds.length === 0) {
          setTaskLibrary({});
          return;
        }

        const { data: assignmentData } = await supabase
          .from("project_task_assignments")
          .select("task_library(id, task_name, category_id, is_active)")
          .in("project_tag_id", tagIds);

        if (cancelled) return;
        const grouped: Record<number, string[]> = {};
        for (const row of (assignmentData ?? []) as Array<{ task_library: Array<{ id: number; task_name: string; category_id: number; is_active: boolean }> | null }>) {
          const libs = Array.isArray(row.task_library) ? row.task_library : (row.task_library ? [row.task_library] : []);
          for (const lib of libs) {
            if (!lib || lib.is_active === false) continue;
            if (!grouped[lib.category_id]) grouped[lib.category_id] = [];
            if (!grouped[lib.category_id].includes(lib.task_name)) {
              grouped[lib.category_id].push(lib.task_name);
            }
          }
        }
        setTaskLibrary(grouped);
      } catch {
        setTaskLibrary({});
      }
    })();
    return () => { cancelled = true; };
  }, [selectedProject?.account]);

  // Derive display categories — use DB rows if non-empty, else hardcoded fallback
  const displayCategories: string[] = taskCategories.length > 0
    ? taskCategories.map((c) => c.category_name)
    : HARDCODED_CATEGORIES;

  // Given a selected category name, find the matching task_library entries
  function getTaskOptions(category: string): string[] {
    const catRow = taskCategories.find((c) => c.category_name === category);
    if (!catRow) return [];
    return taskLibrary[catRow.id] ?? [];
  }

  const handleSelectProject = (project: Project) => {
    setSelectedProject(project);
    setShowCreate(false);
  };

  const handleSaveEdit = async () => {
    if (!selectedProject) return;
    if (!editName.trim()) {
      setEditNotice({ type: "error", text: "Project name is required." });
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
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setEditNotice({ type: "success", text: "Project saved." });
      setSelectedProject((prev) =>
        prev
          ? {
              ...prev,
              name: editName.trim(),
              account: editAccount.trim() || null,
              details: editDetails.trim() || null,
              notes: editNotes.trim() || null,
            }
          : prev
      );
      onRefresh();
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
      onRefresh();
    } catch (e) {
      setEditNotice({ type: "error", text: e instanceof Error ? e.message : "Failed to update." });
    }
  };

  const handleDeleteProject = async (project: Project) => {
    if (!confirm(`Delete project "${project.name}"? Subtasks will remain but will no longer be linked to this project.`)) return;
    try {
      const res = await fetch(`/api/projects?id=${project.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      if (selectedProject?.id === project.id) setSelectedProject(null);
      onRefresh();
    } catch (e) {
      setEditNotice({ type: "error", text: e instanceof Error ? e.message : "Failed to delete." });
    }
  };

  const handleCreateProject = async () => {
    if (!createName.trim()) {
      setCreateError("Project name is required.");
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
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setCreateName("");
      setCreateAccount("");
      setCreateDescription("");
      setCreateDetails("");
      setCreateNotes("");
      setShowCreate(false);
      onRefresh();
      if (d.project) setSelectedProject(d.project as Project);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create project.");
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
        due_date: addForm.due_date || null,
        pay_type: addForm.pay_type || "hourly",
        category: addForm.category.trim() || null,
        task_detail: addForm.task_detail.trim() || null,
        task_notes: addForm.task_notes.trim() || null,
        instructions: addForm.instructions.trim() || null,
        status: addForm.status || "pending",
        assigned_by: addForm.assigned_by_id || null,
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
      setAddForm(defaultSubtaskForm());
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
      // Save metadata (task_name, task_detail, due_date, assigned_by, va_ids) — separate from status
      const metaRes = await fetch(`/api/assigned-tasks/${editingSubId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_name: editSubForm.task_name.trim(),
          task_detail: editSubForm.task_detail.trim() || null,
          due_date: editSubForm.due_date || null,
          assigned_by: editSubForm.assigned_by_id || null,
          va_ids: editSubForm.va_id ? [editSubForm.va_id] : [],
        }),
      });
      if (!metaRes.ok) {
        const d = await metaRes.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${metaRes.status}`);
      }

      // Save status separately (PATCH handler handles status-only updates differently)
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-walnut">Projects</h3>
          <p className="text-xs text-stone">Create projects and add subtasks that auto-appear as assigned tasks for VAs.</p>
        </div>
        <button
          onClick={() => {
            setShowCreate(true);
            setSelectedProject(null);
            setCreateName("");
            setCreateAccount("");
            setCreateDescription("");
            setCreateDetails("");
            setCreateNotes("");
            setCreateError(null);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840]"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Project
        </button>
      </div>

      <div className="flex gap-4 items-start">
        {/* ── Left panel: project list ─────────────────────────────────────────── */}
        <div className="w-64 shrink-0 space-y-2">
          {loading ? (
            <div className="rounded-xl border border-sand bg-white p-4 text-center text-xs text-stone">
              Loading projects...
            </div>
          ) : projects.length === 0 && !showCreate ? (
            <div className="rounded-xl border border-sand bg-white p-6 text-center">
              <p className="text-sm font-medium text-espresso">No projects yet</p>
              <p className="mt-1 text-xs text-stone">Click &ldquo;New Project&rdquo; to get started.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-sand bg-white overflow-hidden shadow-sm divide-y divide-sand">
              {projects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => handleSelectProject(project)}
                  className={`flex flex-col gap-1 px-3 py-2.5 cursor-pointer transition-colors ${
                    selectedProject?.id === project.id
                      ? "bg-parchment"
                      : "hover:bg-cream"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-espresso leading-tight truncate flex-1">
                      {project.name}
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border shrink-0 ${
                      project.is_active
                        ? "bg-sage-soft text-sage border-sage/20"
                        : "bg-stone/10 text-stone border-stone/20"
                    }`}>
                      {project.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  {project.description && (
                    <p className="text-[11px] text-stone/80 truncate">{project.description}</p>
                  )}
                  <p className="text-[10px] text-stone/60">{formatDate(project.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right panel ─────────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {/* Create project form */}
          {showCreate && (
            <div className="rounded-xl border border-sand bg-white p-5 shadow-sm space-y-4">
              <h4 className="text-[13px] font-bold text-espresso">New Project</h4>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                  Project Name
                </label>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Project name"
                  className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                />
              </div>

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

              {createError && (
                <p className="text-[12px] text-red-600">{createError}</p>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleCreateProject()}
                  disabled={creating}
                  className="px-4 py-2 rounded-lg bg-sage text-white text-[13px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create Project"}
                </button>
                <button
                  onClick={() => { setShowCreate(false); setCreateError(null); }}
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
                  <h4 className="text-[13px] font-bold text-espresso">Project Details</h4>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void handleToggleActive(selectedProject)}
                      className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
                    >
                      {selectedProject.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => void handleDeleteProject(selectedProject)}
                      className="px-3 py-1 rounded-lg text-[11px] font-semibold border border-red-200 text-red-600 hover:border-red-400 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                    Project Name
                  </label>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                  />
                </div>

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
                  <div className="rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso min-h-[3rem]">
                    {editDescription || <span className="text-stone">No description</span>}
                  </div>
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
                          {/* Row */}
                          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-sand bg-white hover:bg-cream transition-colors">
                            <StatusBadge status={sub.status} />
                            <span className="flex-1 text-[13px] font-semibold text-espresso leading-tight truncate">
                              {sub.task_name}
                            </span>
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
                                    category: sub.category ?? "",
                                    task_detail: sub.task_detail ?? "",
                                    task_notes: "",
                                    instructions: "",
                                    status: sub.status ?? "pending",
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
                                    Category
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
                                    <option value="">Select category...</option>
                                    {displayCategories.map((cat) => (
                                      <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
                                    Task Name
                                  </label>
                                  {getTaskOptions(editSubForm.category).length > 0 ? (
                                    <select
                                      value={editSubForm.task_name}
                                      onChange={(e) => setEditSubForm((prev) => ({ ...prev, task_name: e.target.value }))}
                                      className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white"
                                    >
                                      <option value="">Select task...</option>
                                      {getTaskOptions(editSubForm.category).map((t) => (
                                        <option key={t} value={t}>{t}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <select
                                      value={editSubForm.task_name}
                                      onChange={(e) => setEditSubForm((prev) => ({ ...prev, task_name: e.target.value }))}
                                      className="w-full rounded-lg border border-sand px-2 py-1.5 text-[12px] outline-none focus:border-terracotta bg-white"
                                    >
                                      <option value={editSubForm.task_name}>{editSubForm.task_name || "No tasks in this category yet"}</option>
                                    </select>
                                  )}
                                </div>
                              </div>

                              <div>
                                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">
                                  Detail
                                </label>
                                <textarea
                                  value={editSubForm.task_detail}
                                  onChange={(e) => setEditSubForm((prev) => ({ ...prev, task_detail: e.target.value }))}
                                  rows={1}
                                  placeholder="Task detail"
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
                                    <option value="hourly">Hourly</option>
                                    <option value="fixed_pay">Fixed Pay</option>
                                  </select>
                                </div>
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
                        Category
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
                        <option value="">Select category...</option>
                        {displayCategories.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
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
                      className="w-full rounded-lg border border-sand px-2 py-1.5 text-[13px] outline-none focus:border-terracotta bg-white"
                    >
                      <option value="">
                        {addForm.category
                          ? getTaskOptions(addForm.category).length > 0
                            ? "Select task..."
                            : "No tasks in this category yet"
                          : "Select a category first..."}
                      </option>
                      {getTaskOptions(addForm.category).map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">
                      Detail
                    </label>
                    <textarea
                      value={addForm.task_detail}
                      onChange={(e) => setAddForm((prev) => ({ ...prev, task_detail: e.target.value }))}
                      rows={1}
                      placeholder="Task detail"
                      className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white resize-none"
                    />
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
                        <option value="hourly">Hourly</option>
                        <option value="fixed_pay">Fixed Pay</option>
                      </select>
                    </div>
                  </div>

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
