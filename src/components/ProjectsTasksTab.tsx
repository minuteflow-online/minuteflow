"use client";

import { useState, useEffect, useCallback } from "react";

/* ── Types ───────────────────────────────────────────────── */

interface Account {
  id: number;
  name: string;
  active: boolean;
}

interface ProjectTag {
  id: number;
  account: string;
  project_name: string;
  sort_order: number;
  is_active: boolean;
}

interface TaskLibraryItem {
  id: number;
  task_name: string;
  is_active: boolean;
  sort_order: number;
}

interface ProjectTaskAssignment {
  id: number;
  task_library_id: number;
  project_tag_id: number;
  sort_order: number;
  task_library: TaskLibraryItem;
}

/* ── Component ───────────────────────────────────────────── */

export default function ProjectsTasksTab() {
  /* ── State: data ─────── */
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<ProjectTag[]>([]);
  const [libraryTasks, setLibraryTasks] = useState<TaskLibraryItem[]>([]);
  const [assignments, setAssignments] = useState<ProjectTaskAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── State: navigation ─────── */
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<ProjectTag | null>(null);

  /* ── State: library task forms ─────── */
  const [showAddLibraryTask, setShowAddLibraryTask] = useState(false);
  const [addLibraryBulk, setAddLibraryBulk] = useState(false);
  const [newLibraryTaskName, setNewLibraryTaskName] = useState("");
  const [bulkLibraryTaskNames, setBulkLibraryTaskNames] = useState("");
  const [addingLibraryTask, setAddingLibraryTask] = useState(false);
  const [editingLibraryTaskId, setEditingLibraryTaskId] = useState<number | null>(null);
  const [editLibraryTaskName, setEditLibraryTaskName] = useState("");
  const [librarySearch, setLibrarySearch] = useState("");

  /* ── State: project forms ─────── */
  const [showAddProject, setShowAddProject] = useState(false);
  const [addProjectBulk, setAddProjectBulk] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [bulkProjectNames, setBulkProjectNames] = useState("");
  const [addingProject, setAddingProject] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editProjectName, setEditProjectName] = useState("");

  /* ── State: bulk selection (library) ─────── */
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<Set<number>>(new Set());

  /* ── State: assigning ─────── */
  const [assigning, setAssigning] = useState(false);

  /* ── State: bulk selection (projects) ─────── */
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<number>>(new Set());
  const [bulkDeletingProjects, setBulkDeletingProjects] = useState(false);

  /* ── Fetch data ─────── */
  const fetchAccounts = useCallback(async () => {
    const res = await fetch("/api/accounts");
    const data = await res.json();
    setAccounts((data.accounts ?? []).filter((a: Account) => a.active));
    setLoading(false);
  }, []);

  const fetchProjects = useCallback(async (account: string) => {
    const res = await fetch(`/api/project-tags?account=${encodeURIComponent(account)}`);
    const data = await res.json();
    setProjects(data.projects ?? []);
  }, []);

  const fetchLibraryTasks = useCallback(async () => {
    const res = await fetch("/api/task-library");
    const data = await res.json();
    setLibraryTasks(data.tasks ?? []);
  }, []);

  const fetchAssignments = useCallback(async (projectTagId: number) => {
    const res = await fetch(`/api/project-task-assignments?project_tag_id=${projectTagId}`);
    const data = await res.json();
    setAssignments(data.assignments ?? []);
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchLibraryTasks();
  }, [fetchAccounts, fetchLibraryTasks]);

  useEffect(() => {
    if (selectedAccount) {
      fetchProjects(selectedAccount);
      setSelectedProject(null);
      setAssignments([]);
      setSelectedProjectIds(new Set());
    }
  }, [selectedAccount, fetchProjects]);

  useEffect(() => {
    if (selectedProject) {
      fetchAssignments(selectedProject.id);
    }
  }, [selectedProject, fetchAssignments]);

  /* ── Library Task CRUD ─────── */
  const handleAddLibraryTask = async () => {
    setAddingLibraryTask(true);
    if (addLibraryBulk) {
      const names = bulkLibraryTaskNames.split("\n").map((l) => l.trim()).filter(Boolean);
      if (names.length === 0) { setAddingLibraryTask(false); return; }
      const res = await fetch("/api/task-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to add tasks");
      }
      setBulkLibraryTaskNames("");
    } else {
      if (!newLibraryTaskName.trim()) { setAddingLibraryTask(false); return; }
      const res = await fetch("/api/task-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_name: newLibraryTaskName.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to add task");
      }
      setNewLibraryTaskName("");
    }
    setShowAddLibraryTask(false);
    setAddingLibraryTask(false);
    fetchLibraryTasks();
  };

  const handleEditLibraryTask = async (id: number) => {
    if (!editLibraryTaskName.trim()) return;
    const res = await fetch("/api/task-library", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, task_name: editLibraryTaskName.trim() }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to rename task");
    }
    setEditingLibraryTaskId(null);
    fetchLibraryTasks();
    // Refresh assignments too since the name change propagates
    if (selectedProject) fetchAssignments(selectedProject.id);
  };

  const handleDeleteLibraryTask = async (t: TaskLibraryItem) => {
    if (!window.confirm(`Delete "${t.task_name}" from the library? This removes it from ALL projects.`)) return;
    await fetch(`/api/task-library?id=${t.id}`, { method: "DELETE" });
    fetchLibraryTasks();
    if (selectedProject) fetchAssignments(selectedProject.id);
  };

  const handleBulkDeleteLibraryTasks = async () => {
    if (selectedLibraryIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedLibraryIds.size} task(s) from the library? This removes them from ALL projects.`)) return;
    const ids = Array.from(selectedLibraryIds).join(",");
    await fetch(`/api/task-library?ids=${ids}`, { method: "DELETE" });
    setSelectedLibraryIds(new Set());
    fetchLibraryTasks();
    if (selectedProject) fetchAssignments(selectedProject.id);
  };

  /* ── Assignment actions ─────── */
  const handleAssignToProject = async () => {
    if (!selectedProject || selectedLibraryIds.size === 0) return;
    setAssigning(true);
    // Filter out tasks already assigned
    const alreadyAssigned = new Set(assignments.map((a) => a.task_library_id));
    const toAssign = Array.from(selectedLibraryIds).filter((id) => !alreadyAssigned.has(id));
    if (toAssign.length === 0) {
      alert("All selected tasks are already assigned to this project.");
      setAssigning(false);
      return;
    }
    const res = await fetch("/api/project-task-assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_tag_id: selectedProject.id, task_library_ids: toAssign }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to assign tasks");
    }
    setSelectedLibraryIds(new Set());
    setAssigning(false);
    fetchAssignments(selectedProject.id);
  };

  const handleUnassignTask = async (assignmentId: number) => {
    await fetch(`/api/project-task-assignments?id=${assignmentId}`, { method: "DELETE" });
    if (selectedProject) fetchAssignments(selectedProject.id);
  };

  const handleMoveAssignment = async (index: number, direction: "up" | "down") => {
    const sorted = [...assignments].sort((a, b) => a.sort_order - b.sort_order);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= sorted.length) return;

    const reorder = [
      { id: sorted[index].id, sort_order: sorted[swapIndex].sort_order },
      { id: sorted[swapIndex].id, sort_order: sorted[index].sort_order },
    ];

    await fetch("/api/project-task-assignments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reorder }),
    });
    if (selectedProject) fetchAssignments(selectedProject.id);
  };

  /* ── Project CRUD ─────── */
  const handleAddProject = async () => {
    if (!selectedAccount) return;
    setAddingProject(true);
    if (addProjectBulk) {
      const names = bulkProjectNames.split("\n").map((l) => l.trim()).filter(Boolean);
      if (names.length === 0) { setAddingProject(false); return; }
      await fetch("/api/project-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: selectedAccount, names }),
      });
      setBulkProjectNames("");
    } else {
      if (!newProjectName.trim()) { setAddingProject(false); return; }
      await fetch("/api/project-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: selectedAccount, project_name: newProjectName.trim() }),
      });
      setNewProjectName("");
    }
    setShowAddProject(false);
    setAddingProject(false);
    fetchProjects(selectedAccount);
  };

  const handleEditProject = async (id: number) => {
    if (!editProjectName.trim()) return;
    await fetch("/api/project-tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, project_name: editProjectName.trim() }),
    });
    setEditingProjectId(null);
    if (selectedAccount) fetchProjects(selectedAccount);
  };

  const handleToggleProject = async (p: ProjectTag) => {
    await fetch("/api/project-tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, is_active: !p.is_active }),
    });
    if (selectedAccount) fetchProjects(selectedAccount);
  };

  const handleDeleteProject = async (p: ProjectTag) => {
    if (!window.confirm(`Delete project "${p.project_name}"? This cannot be undone.`)) return;
    await fetch(`/api/project-tags?id=${p.id}`, { method: "DELETE" });
    if (selectedProject?.id === p.id) {
      setSelectedProject(null);
      setAssignments([]);
    }
    if (selectedAccount) fetchProjects(selectedAccount);
  };

  const handleMoveProject = async (index: number, direction: "up" | "down") => {
    const sorted = [...projects].sort((a, b) => a.sort_order - b.sort_order);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= sorted.length) return;

    const reorder = [
      { id: sorted[index].id, sort_order: sorted[swapIndex].sort_order },
      { id: sorted[swapIndex].id, sort_order: sorted[index].sort_order },
    ];

    await fetch("/api/project-tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reorder }),
    });
    if (selectedAccount) fetchProjects(selectedAccount);
  };

  const handleBulkDeleteProjects = async () => {
    if (selectedProjectIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedProjectIds.size} selected project(s)? This cannot be undone.`)) return;
    setBulkDeletingProjects(true);
    const ids = Array.from(selectedProjectIds).join(",");
    await fetch(`/api/project-tags?ids=${ids}`, { method: "DELETE" });
    setSelectedProjectIds(new Set());
    setBulkDeletingProjects(false);
    if (selectedAccount) fetchProjects(selectedAccount);
  };

  const toggleProjectSelection = (id: number) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllProjects = (allIds: number[]) => {
    setSelectedProjectIds((prev) =>
      prev.size === allIds.length ? new Set() : new Set(allIds)
    );
  };

  /* ── Library helpers ─────── */
  const toggleLibrarySelection = (id: number) => {
    setSelectedLibraryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllLibrary = (allIds: number[]) => {
    setSelectedLibraryIds((prev) =>
      prev.size === allIds.length ? new Set() : new Set(allIds)
    );
  };

  const filteredLibraryTasks = librarySearch
    ? libraryTasks.filter((t) => t.task_name.toLowerCase().includes(librarySearch.toLowerCase()))
    : libraryTasks;

  const assignedTaskIds = new Set(assignments.map((a) => a.task_library_id));

  /* ── Render: loading ─────── */
  if (loading) {
    return <div className="h-48 animate-pulse rounded-xl border border-sand bg-white" />;
  }

  /* ── Render: account selection (before side-by-side) ─────── */
  if (!selectedAccount) {
    return (
      <div className="space-y-4">
        <p className="text-[13px] text-bark">Click an account to manage its projects and tasks.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {accounts.map((acc) => (
            <button
              key={acc.id}
              onClick={() => setSelectedAccount(acc.name)}
              className="group rounded-xl border border-sand bg-white p-4 text-left transition-all hover:border-terracotta hover:shadow-sm cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-terracotta-soft flex items-center justify-center">
                  <svg className="h-4 w-4 text-terracotta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" />
                    <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-espresso truncate">{acc.name}</div>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-stone group-hover:text-terracotta transition-colors">
                Click to manage projects &rarr;
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  /* ── Render: SIDE-BY-SIDE LAYOUT ─────── */
  const sortedProjects = [...projects].sort((a, b) => a.sort_order - b.sort_order);
  const sortedAssignments = [...assignments].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-4">
      {/* Breadcrumb / back nav */}
      <div className="flex items-center gap-1.5 text-[13px]">
        <button
          onClick={() => { setSelectedAccount(null); setSelectedProject(null); setProjects([]); setAssignments([]); }}
          className="font-semibold cursor-pointer text-terracotta hover:text-[#a85840] transition-colors"
        >
          Accounts
        </button>
        <span className="text-stone">/</span>
        <span className="font-semibold text-espresso">{selectedAccount}</span>
      </div>

      {/* Side-by-side grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* ═══ LEFT PANEL: Global Task Library ═══ */}
        <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-espresso uppercase tracking-wide flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5 text-terracotta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              Task Library
              <span className="text-stone font-normal normal-case">({libraryTasks.length})</span>
            </h3>
            <button
              onClick={() => { setShowAddLibraryTask(!showAddLibraryTask); setAddLibraryBulk(false); }}
              className="text-[12px] font-semibold text-terracotta hover:text-[#a85840] cursor-pointer"
            >
              {showAddLibraryTask ? "Cancel" : "+ Add"}
            </button>
          </div>

          {/* Add task form */}
          {showAddLibraryTask && (
            <div className="rounded-lg border border-sand bg-parchment p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-espresso">
                  {addLibraryBulk ? "Bulk Add" : "Add Task"}
                </span>
                <button
                  onClick={() => setAddLibraryBulk(!addLibraryBulk)}
                  className="text-[10px] font-semibold text-terracotta cursor-pointer"
                >
                  {addLibraryBulk ? "Single" : "Bulk"}
                </button>
              </div>
              {addLibraryBulk ? (
                <textarea
                  value={bulkLibraryTaskNames}
                  onChange={(e) => setBulkLibraryTaskNames(e.target.value)}
                  placeholder={"One task per line\ne.g.\nCheck Emails\nClient Follow-up\nPost on Social Media"}
                  rows={4}
                  className="w-full rounded-lg border border-sand px-2.5 py-1.5 text-xs text-espresso outline-none focus:border-terracotta resize-none"
                />
              ) : (
                <input
                  value={newLibraryTaskName}
                  onChange={(e) => setNewLibraryTaskName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddLibraryTask()}
                  placeholder="Task name"
                  className="w-full rounded-lg border border-sand px-2.5 py-1.5 text-xs text-espresso outline-none focus:border-terracotta"
                  autoFocus
                />
              )}
              <button
                onClick={handleAddLibraryTask}
                disabled={addingLibraryTask || (addLibraryBulk ? !bulkLibraryTaskNames.trim() : !newLibraryTaskName.trim())}
                className="w-full py-1.5 rounded-lg bg-terracotta text-white text-xs font-semibold disabled:opacity-50 cursor-pointer hover:bg-[#a85840] transition-colors"
              >
                {addingLibraryTask ? "Adding..." : "Add to Library"}
              </button>
            </div>
          )}

          {/* Search */}
          <input
            value={librarySearch}
            onChange={(e) => setLibrarySearch(e.target.value)}
            placeholder="Search tasks..."
            className="w-full rounded-lg border border-sand px-2.5 py-1.5 text-xs text-espresso outline-none focus:border-terracotta"
          />

          {/* Select all + bulk actions */}
          {filteredLibraryTasks.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-bark select-none">
                <input
                  type="checkbox"
                  checked={selectedLibraryIds.size === filteredLibraryTasks.length && filteredLibraryTasks.length > 0}
                  onChange={() => toggleAllLibrary(filteredLibraryTasks.map((t) => t.id))}
                  className="h-3 w-3 rounded border-sand text-terracotta accent-terracotta cursor-pointer"
                />
                Select All
              </label>
              {selectedLibraryIds.size > 0 && selectedProject && (
                <button
                  onClick={handleAssignToProject}
                  disabled={assigning}
                  className="text-[11px] font-semibold text-sage hover:text-[#5a7a5e] cursor-pointer disabled:opacity-50"
                >
                  {assigning ? "Assigning..." : `Assign (${selectedLibraryIds.size}) → ${selectedProject.project_name}`}
                </button>
              )}
              {selectedLibraryIds.size > 0 && (
                <button
                  onClick={handleBulkDeleteLibraryTasks}
                  className="text-[11px] font-semibold text-red-600 hover:text-red-700 cursor-pointer"
                >
                  Delete ({selectedLibraryIds.size})
                </button>
              )}
            </div>
          )}

          {/* Assign hint */}
          {selectedLibraryIds.size > 0 && !selectedProject && (
            <p className="text-[11px] text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5">
              Select a project on the right to assign these tasks →
            </p>
          )}

          {/* Task list */}
          <div className="space-y-1 max-h-[500px] overflow-y-auto pr-1">
            {filteredLibraryTasks.length === 0 ? (
              <p className="text-[12px] text-stone text-center py-4">
                {librarySearch ? "No tasks match your search." : "No tasks yet. Add your first one!"}
              </p>
            ) : (
              filteredLibraryTasks.map((t) => (
                <div
                  key={t.id}
                  className={`rounded-lg border p-2 flex items-center gap-2 transition-all text-xs ${
                    selectedLibraryIds.has(t.id) ? "border-terracotta/40 bg-terracotta-soft/30 ring-1 ring-terracotta/20" : "border-sand bg-white"
                  } ${assignedTaskIds.has(t.id) && selectedProject ? "border-l-2 border-l-sage" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedLibraryIds.has(t.id)}
                    onChange={() => toggleLibrarySelection(t.id)}
                    className="h-3 w-3 rounded border-sand text-terracotta accent-terracotta cursor-pointer shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    {editingLibraryTaskId === t.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          value={editLibraryTaskName}
                          onChange={(e) => setEditLibraryTaskName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleEditLibraryTask(t.id);
                            if (e.key === "Escape") setEditingLibraryTaskId(null);
                          }}
                          className="flex-1 rounded border border-terracotta px-1.5 py-0.5 text-xs text-espresso outline-none"
                          autoFocus
                        />
                        <button onClick={() => handleEditLibraryTask(t.id)} className="text-[10px] font-semibold text-sage cursor-pointer">Save</button>
                        <button onClick={() => setEditingLibraryTaskId(null)} className="text-[10px] text-stone cursor-pointer">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-espresso truncate">{t.task_name}</span>
                        {assignedTaskIds.has(t.id) && selectedProject && (
                          <span className="shrink-0 text-[9px] bg-sage-soft text-sage px-1.5 py-0.5 rounded-full font-semibold">assigned</span>
                        )}
                      </div>
                    )}
                  </div>
                  {editingLibraryTaskId !== t.id && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => { setEditingLibraryTaskId(t.id); setEditLibraryTaskName(t.task_name); }}
                        className="p-1 rounded text-stone hover:text-espresso hover:bg-parchment cursor-pointer"
                        title="Rename"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteLibraryTask(t)}
                        className="p-1 rounded text-stone hover:text-red-600 hover:bg-red-50 cursor-pointer"
                        title="Delete from library"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ═══ RIGHT PANEL: Projects & Assigned Tasks ═══ */}
        <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-espresso uppercase tracking-wide flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5 text-terracotta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" />
                <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
              </svg>
              Projects
              <span className="text-stone font-normal normal-case">({sortedProjects.length})</span>
            </h3>
            <button
              onClick={() => { setShowAddProject(!showAddProject); setAddProjectBulk(false); }}
              className="text-[12px] font-semibold text-terracotta hover:text-[#a85840] cursor-pointer"
            >
              {showAddProject ? "Cancel" : "+ Add"}
            </button>
          </div>

          {/* Add project form */}
          {showAddProject && (
            <div className="rounded-lg border border-sand bg-parchment p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-espresso">
                  {addProjectBulk ? "Bulk Add" : "Add Project"}
                </span>
                <button
                  onClick={() => setAddProjectBulk(!addProjectBulk)}
                  className="text-[10px] font-semibold text-terracotta cursor-pointer"
                >
                  {addProjectBulk ? "Single" : "Bulk"}
                </button>
              </div>
              {addProjectBulk ? (
                <textarea
                  value={bulkProjectNames}
                  onChange={(e) => setBulkProjectNames(e.target.value)}
                  placeholder={"One project per line\ne.g.\nCase Management\nContent Creation"}
                  rows={4}
                  className="w-full rounded-lg border border-sand px-2.5 py-1.5 text-xs text-espresso outline-none focus:border-terracotta resize-none"
                />
              ) : (
                <input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddProject()}
                  placeholder="Project name"
                  className="w-full rounded-lg border border-sand px-2.5 py-1.5 text-xs text-espresso outline-none focus:border-terracotta"
                  autoFocus
                />
              )}
              <button
                onClick={handleAddProject}
                disabled={addingProject || (addProjectBulk ? !bulkProjectNames.trim() : !newProjectName.trim())}
                className="w-full py-1.5 rounded-lg bg-terracotta text-white text-xs font-semibold disabled:opacity-50 cursor-pointer hover:bg-[#a85840] transition-colors"
              >
                {addingProject ? "Adding..." : "Add Project"}
              </button>
            </div>
          )}

          {/* Select all + bulk delete for projects */}
          {sortedProjects.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-bark select-none">
                <input
                  type="checkbox"
                  checked={selectedProjectIds.size === sortedProjects.length && sortedProjects.length > 0}
                  onChange={() => toggleAllProjects(sortedProjects.map((p) => p.id))}
                  className="h-3 w-3 rounded border-sand text-terracotta accent-terracotta cursor-pointer"
                />
                Select All
              </label>
              {selectedProjectIds.size > 0 && (
                <button
                  onClick={handleBulkDeleteProjects}
                  disabled={bulkDeletingProjects}
                  className="text-[11px] font-semibold text-red-600 hover:text-red-700 cursor-pointer disabled:opacity-50"
                >
                  {bulkDeletingProjects ? "Deleting..." : `Delete (${selectedProjectIds.size})`}
                </button>
              )}
            </div>
          )}

          {/* Projects list */}
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
            {sortedProjects.length === 0 ? (
              <p className="text-[12px] text-stone text-center py-4">No projects yet.</p>
            ) : (
              sortedProjects.map((p, index) => (
                <div
                  key={p.id}
                  className={`rounded-lg border p-2 flex items-center gap-2 transition-all text-xs cursor-pointer ${
                    selectedProject?.id === p.id
                      ? "border-terracotta bg-terracotta-soft/30 ring-1 ring-terracotta/30"
                      : p.is_active ? "border-sand bg-white hover:border-terracotta/50" : "border-sand/50 opacity-50"
                  } ${selectedProjectIds.has(p.id) ? "ring-2 ring-terracotta/20" : ""}`}
                  onClick={() => {
                    if (editingProjectId !== p.id) setSelectedProject(p);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedProjectIds.has(p.id)}
                    onChange={(e) => { e.stopPropagation(); toggleProjectSelection(p.id); }}
                    className="h-3 w-3 rounded border-sand text-terracotta accent-terracotta cursor-pointer shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  />
                  {/* Reorder */}
                  <div className="flex flex-col gap-0" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => handleMoveProject(index, "up")} disabled={index === 0} className="text-[9px] text-stone hover:text-espresso disabled:opacity-25 cursor-pointer leading-none">&#9650;</button>
                    <button onClick={() => handleMoveProject(index, "down")} disabled={index === sortedProjects.length - 1} className="text-[9px] text-stone hover:text-espresso disabled:opacity-25 cursor-pointer leading-none">&#9660;</button>
                  </div>
                  <div className="flex-1 min-w-0">
                    {editingProjectId === p.id ? (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          value={editProjectName}
                          onChange={(e) => setEditProjectName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleEditProject(p.id); if (e.key === "Escape") setEditingProjectId(null); }}
                          className="flex-1 rounded border border-terracotta px-1.5 py-0.5 text-xs text-espresso outline-none"
                          autoFocus
                        />
                        <button onClick={() => handleEditProject(p.id)} className="text-[10px] font-semibold text-sage cursor-pointer">Save</button>
                        <button onClick={() => setEditingProjectId(null)} className="text-[10px] text-stone cursor-pointer">Cancel</button>
                      </div>
                    ) : (
                      <span className="font-semibold text-espresso truncate block">{p.project_name}</span>
                    )}
                  </div>
                  {editingProjectId !== p.id && (
                    <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setEditingProjectId(p.id); setEditProjectName(p.project_name); }} className="p-1 rounded text-stone hover:text-espresso hover:bg-parchment cursor-pointer" title="Edit">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      </button>
                      <button onClick={() => handleToggleProject(p)} className={`p-1 rounded cursor-pointer ${p.is_active ? "text-sage hover:text-[#5a7a5e]" : "text-stone hover:text-espresso"}`} title={p.is_active ? "Deactivate" : "Activate"}>
                        {p.is_active ? (
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                        ) : (
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                        )}
                      </button>
                      <button onClick={() => handleDeleteProject(p)} className="p-1 rounded text-stone hover:text-red-600 hover:bg-red-50 cursor-pointer" title="Delete">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* ── Assigned Tasks for selected project ── */}
          {selectedProject && (
            <div className="border-t border-sand pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-bold text-espresso uppercase tracking-wide">
                  Tasks in &ldquo;{selectedProject.project_name}&rdquo;
                  <span className="text-stone font-normal normal-case ml-1">({sortedAssignments.length})</span>
                </h4>
              </div>

              {sortedAssignments.length === 0 ? (
                <p className="text-[11px] text-stone text-center py-3 bg-parchment rounded-lg">
                  No tasks assigned yet. Select tasks on the left and click &ldquo;Assign&rdquo;.
                </p>
              ) : (
                <div className="space-y-1 max-h-[250px] overflow-y-auto pr-1">
                  {sortedAssignments.map((a, index) => (
                    <div
                      key={a.id}
                      className="rounded-lg border border-sand bg-white p-2 flex items-center gap-2 text-xs"
                    >
                      {/* Reorder */}
                      <div className="flex flex-col gap-0">
                        <button onClick={() => handleMoveAssignment(index, "up")} disabled={index === 0} className="text-[9px] text-stone hover:text-espresso disabled:opacity-25 cursor-pointer leading-none">&#9650;</button>
                        <button onClick={() => handleMoveAssignment(index, "down")} disabled={index === sortedAssignments.length - 1} className="text-[9px] text-stone hover:text-espresso disabled:opacity-25 cursor-pointer leading-none">&#9660;</button>
                      </div>
                      <span className="flex-1 text-espresso truncate">{a.task_library?.task_name ?? "Unknown"}</span>
                      <button
                        onClick={() => handleUnassignTask(a.id)}
                        className="p-1 rounded text-stone hover:text-red-600 hover:bg-red-50 cursor-pointer shrink-0"
                        title="Remove from project"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

          {!selectedProject && sortedProjects.length > 0 && (
            <p className="text-[11px] text-stone text-center py-2 bg-parchment rounded-lg">
              Click a project above to see its assigned tasks.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
