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

interface TaskTemplate {
  id: number;
  project_tag_id: number;
  task_name: string;
  sort_order: number;
  is_active: boolean;
}

/* ── Component ───────────────────────────────────────────── */

export default function ProjectsTasksTab() {
  /* ── State: data ─────── */
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<ProjectTag[]>([]);
  const [tasks, setTasks] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── State: navigation ─────── */
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<ProjectTag | null>(null);

  /* ── State: add forms ─────── */
  const [showAddProject, setShowAddProject] = useState(false);
  const [addProjectBulk, setAddProjectBulk] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [bulkProjectNames, setBulkProjectNames] = useState("");
  const [addingProject, setAddingProject] = useState(false);

  const [showAddTask, setShowAddTask] = useState(false);
  const [addTaskBulk, setAddTaskBulk] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [bulkTaskNames, setBulkTaskNames] = useState("");
  const [addingTask, setAddingTask] = useState(false);

  /* ── State: bulk selection ─────── */
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<number>>(new Set());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [bulkDeletingProjects, setBulkDeletingProjects] = useState(false);
  const [bulkDeletingTasks, setBulkDeletingTasks] = useState(false);

  /* ── State: inline editing ─────── */
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editProjectName, setEditProjectName] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editTaskName, setEditTaskName] = useState("");

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

  const fetchTasks = useCallback(async (projectTagId: number) => {
    const res = await fetch(`/api/task-templates?project_tag_id=${projectTagId}`);
    const data = await res.json();
    setTasks(data.tasks ?? []);
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    if (selectedAccount) {
      fetchProjects(selectedAccount);
      setSelectedProject(null);
      setTasks([]);
      setSelectedProjectIds(new Set());
      setSelectedTaskIds(new Set());
    }
  }, [selectedAccount, fetchProjects]);

  useEffect(() => {
    if (selectedProject) {
      fetchTasks(selectedProject.id);
      setSelectedTaskIds(new Set());
    }
  }, [selectedProject, fetchTasks]);

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

  const handleDeleteProject = async (p: ProjectTag) => {
    if (!window.confirm(`Delete project "${p.project_name}"? This cannot be undone.`)) return;
    await fetch(`/api/project-tags?id=${p.id}`, { method: "DELETE" });
    if (selectedAccount) fetchProjects(selectedAccount);
  };

  const handleBulkDeleteProjects = async () => {
    if (selectedProjectIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedProjectIds.size} selected project${selectedProjectIds.size !== 1 ? "s" : ""}? This cannot be undone.`)) return;
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

  /* ── Task CRUD ─────── */
  const handleAddTask = async () => {
    if (!selectedProject) return;
    setAddingTask(true);

    if (addTaskBulk) {
      const names = bulkTaskNames.split("\n").map((l) => l.trim()).filter(Boolean);
      if (names.length === 0) { setAddingTask(false); return; }
      await fetch("/api/task-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_tag_id: selectedProject.id, names }),
      });
      setBulkTaskNames("");
    } else {
      if (!newTaskName.trim()) { setAddingTask(false); return; }
      await fetch("/api/task-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_tag_id: selectedProject.id, task_name: newTaskName.trim() }),
      });
      setNewTaskName("");
    }

    setShowAddTask(false);
    setAddingTask(false);
    fetchTasks(selectedProject.id);
  };

  const handleEditTask = async (id: number) => {
    if (!editTaskName.trim()) return;
    await fetch("/api/task-templates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, task_name: editTaskName.trim() }),
    });
    setEditingTaskId(null);
    if (selectedProject) fetchTasks(selectedProject.id);
  };

  const handleToggleTask = async (t: TaskTemplate) => {
    await fetch("/api/task-templates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id, is_active: !t.is_active }),
    });
    if (selectedProject) fetchTasks(selectedProject.id);
  };

  const handleMoveTask = async (index: number, direction: "up" | "down") => {
    const sorted = [...tasks].sort((a, b) => a.sort_order - b.sort_order);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= sorted.length) return;

    const reorder = [
      { id: sorted[index].id, sort_order: sorted[swapIndex].sort_order },
      { id: sorted[swapIndex].id, sort_order: sorted[index].sort_order },
    ];

    await fetch("/api/task-templates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reorder }),
    });
    if (selectedProject) fetchTasks(selectedProject.id);
  };

  const handleDeleteTask = async (t: TaskTemplate) => {
    if (!window.confirm(`Delete task "${t.task_name}"? This cannot be undone.`)) return;
    await fetch(`/api/task-templates?id=${t.id}`, { method: "DELETE" });
    if (selectedProject) fetchTasks(selectedProject.id);
  };

  const handleBulkDeleteTasks = async () => {
    if (selectedTaskIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedTaskIds.size} selected task${selectedTaskIds.size !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBulkDeletingTasks(true);
    const ids = Array.from(selectedTaskIds).join(",");
    await fetch(`/api/task-templates?ids=${ids}`, { method: "DELETE" });
    setSelectedTaskIds(new Set());
    setBulkDeletingTasks(false);
    if (selectedProject) fetchTasks(selectedProject.id);
  };

  const toggleTaskSelection = (id: number) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllTasks = (allIds: number[]) => {
    setSelectedTaskIds((prev) =>
      prev.size === allIds.length ? new Set() : new Set(allIds)
    );
  };

  /* ── Render: loading ─────── */
  if (loading) {
    return <div className="h-48 animate-pulse rounded-xl border border-sand bg-white" />;
  }

  /* ── Render: breadcrumb ─────── */
  const breadcrumb = (
    <div className="flex items-center gap-1.5 text-[13px] mb-4">
      <button
        onClick={() => { setSelectedAccount(null); setSelectedProject(null); setProjects([]); setTasks([]); }}
        className={`font-semibold cursor-pointer transition-colors ${!selectedAccount ? "text-espresso" : "text-terracotta hover:text-[#a85840]"}`}
      >
        Accounts
      </button>
      {selectedAccount && (
        <>
          <span className="text-stone">/</span>
          <button
            onClick={() => { setSelectedProject(null); setTasks([]); }}
            className={`font-semibold cursor-pointer transition-colors ${!selectedProject ? "text-espresso" : "text-terracotta hover:text-[#a85840]"}`}
          >
            {selectedAccount}
          </button>
        </>
      )}
      {selectedProject && (
        <>
          <span className="text-stone">/</span>
          <span className="font-semibold text-espresso">{selectedProject.project_name}</span>
        </>
      )}
    </div>
  );

  /* ── Render: accounts list ─────── */
  if (!selectedAccount) {
    return (
      <div className="space-y-4">
        {breadcrumb}
        <p className="text-[13px] text-bark">Click an account to manage its projects and tasks.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {accounts.map((acc) => {
            const projectCount = 0; // We'll show count after clicking in
            return (
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
            );
          })}
        </div>
      </div>
    );
  }

  /* ── Render: projects list ─────── */
  if (!selectedProject) {
    const sortedProjects = [...projects].sort((a, b) => a.sort_order - b.sort_order);

    return (
      <div className="space-y-4">
        {breadcrumb}

        <div className="flex items-center justify-between">
          <p className="text-[13px] text-bark">
            {sortedProjects.length === 0
              ? "No projects yet. Add your first one!"
              : `${sortedProjects.length} project${sortedProjects.length !== 1 ? "s" : ""}`}
          </p>
          <button
            onClick={() => { setShowAddProject(!showAddProject); setAddProjectBulk(false); }}
            className="text-[13px] font-semibold text-terracotta hover:text-[#a85840] cursor-pointer"
          >
            {showAddProject ? "Cancel" : "+ Add Projects"}
          </button>
        </div>

        {/* Add project form */}
        {showAddProject && (
          <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-espresso uppercase tracking-wide">
                {addProjectBulk ? "Bulk Add Projects" : "Add Project"}
              </span>
              <button
                onClick={() => setAddProjectBulk(!addProjectBulk)}
                className="text-[11px] font-semibold text-terracotta hover:text-[#a85840] cursor-pointer"
              >
                {addProjectBulk ? "Single" : "Bulk"}
              </button>
            </div>
            {addProjectBulk ? (
              <textarea
                value={bulkProjectNames}
                onChange={(e) => setBulkProjectNames(e.target.value)}
                placeholder="One project per line&#10;e.g.&#10;Case Management&#10;Content Creation&#10;Social Media"
                rows={5}
                className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none focus:border-terracotta resize-none"
              />
            ) : (
              <input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddProject()}
                placeholder="Project name"
                className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none focus:border-terracotta"
                autoFocus
              />
            )}
            <button
              onClick={handleAddProject}
              disabled={addingProject || (addProjectBulk ? !bulkProjectNames.trim() : !newProjectName.trim())}
              className="w-full py-2 rounded-lg bg-terracotta text-white text-sm font-semibold disabled:opacity-50 cursor-pointer hover:bg-[#a85840] transition-colors"
            >
              {addingProject ? "Adding..." : addProjectBulk ? "Add All Projects" : "Add Project"}
            </button>
          </div>
        )}

        {/* Bulk actions bar */}
        {sortedProjects.length > 0 && (
          <div className="flex items-center gap-3 px-1">
            <label className="flex items-center gap-2 cursor-pointer text-[12px] text-bark select-none">
              <input
                type="checkbox"
                checked={selectedProjectIds.size === sortedProjects.length && sortedProjects.length > 0}
                onChange={() => toggleAllProjects(sortedProjects.map((p) => p.id))}
                className="h-3.5 w-3.5 rounded border-sand text-terracotta accent-terracotta cursor-pointer"
              />
              Select All
            </label>
            {selectedProjectIds.size > 0 && (
              <button
                onClick={handleBulkDeleteProjects}
                disabled={bulkDeletingProjects}
                className="text-[12px] font-semibold text-red-600 hover:text-red-700 cursor-pointer disabled:opacity-50"
              >
                {bulkDeletingProjects ? "Deleting..." : `Delete Selected (${selectedProjectIds.size})`}
              </button>
            )}
          </div>
        )}

        {/* Projects list */}
        <div className="space-y-2">
          {sortedProjects.map((p, index) => (
            <div
              key={p.id}
              className={`rounded-xl border bg-white p-3 flex items-center gap-3 transition-all ${
                p.is_active ? "border-sand hover:border-terracotta hover:shadow-sm" : "border-sand/50 opacity-50"
              } ${selectedProjectIds.has(p.id) ? "ring-2 ring-terracotta/30" : ""}`}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={selectedProjectIds.has(p.id)}
                onChange={() => toggleProjectSelection(p.id)}
                className="h-3.5 w-3.5 rounded border-sand text-terracotta accent-terracotta cursor-pointer shrink-0"
              />

              {/* Reorder buttons */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => handleMoveProject(index, "up")}
                  disabled={index === 0}
                  className="text-[10px] text-stone hover:text-espresso disabled:opacity-25 cursor-pointer"
                  title="Move up"
                >
                  &#9650;
                </button>
                <button
                  onClick={() => handleMoveProject(index, "down")}
                  disabled={index === sortedProjects.length - 1}
                  className="text-[10px] text-stone hover:text-espresso disabled:opacity-25 cursor-pointer"
                  title="Move down"
                >
                  &#9660;
                </button>
              </div>

              {/* Project name or edit input */}
              <div className="flex-1 min-w-0">
                {editingProjectId === p.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={editProjectName}
                      onChange={(e) => setEditProjectName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleEditProject(p.id);
                        if (e.key === "Escape") setEditingProjectId(null);
                      }}
                      className="flex-1 rounded border border-terracotta px-2 py-1 text-sm text-espresso outline-none"
                      autoFocus
                    />
                    <button
                      onClick={() => handleEditProject(p.id)}
                      className="text-xs font-semibold text-sage hover:text-[#5a7a5e] cursor-pointer"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingProjectId(null)}
                      className="text-xs text-stone hover:text-espresso cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setSelectedProject(p)}
                    className="w-full text-left cursor-pointer"
                  >
                    <span className="text-sm font-semibold text-espresso">{p.project_name}</span>
                    <span className="text-[11px] text-stone ml-2">Click to manage tasks &rarr;</span>
                  </button>
                )}
              </div>

              {/* Actions */}
              {editingProjectId !== p.id && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setEditingProjectId(p.id); setEditProjectName(p.project_name); }}
                    className="p-1.5 rounded-lg text-stone hover:text-espresso hover:bg-parchment cursor-pointer transition-colors"
                    title="Edit name"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleToggleProject(p)}
                    className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                      p.is_active
                        ? "text-sage hover:text-[#5a7a5e] hover:bg-sage-soft"
                        : "text-stone hover:text-espresso hover:bg-parchment"
                    }`}
                    title={p.is_active ? "Deactivate" : "Activate"}
                  >
                    {p.is_active ? (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() => handleDeleteProject(p)}
                    className="p-1.5 rounded-lg text-stone hover:text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
                    title="Delete project"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── Render: tasks list ─────── */
  const sortedTasks = [...tasks].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-4">
      {breadcrumb}

      <div className="flex items-center justify-between">
        <p className="text-[13px] text-bark">
          {sortedTasks.length === 0
            ? "No tasks yet. Add your first one!"
            : `${sortedTasks.length} task${sortedTasks.length !== 1 ? "s" : ""}`}
        </p>
        <button
          onClick={() => { setShowAddTask(!showAddTask); setAddTaskBulk(false); }}
          className="text-[13px] font-semibold text-terracotta hover:text-[#a85840] cursor-pointer"
        >
          {showAddTask ? "Cancel" : "+ Add Tasks"}
        </button>
      </div>

      {/* Add task form */}
      {showAddTask && (
        <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-espresso uppercase tracking-wide">
              {addTaskBulk ? "Bulk Add Tasks" : "Add Task"}
            </span>
            <button
              onClick={() => setAddTaskBulk(!addTaskBulk)}
              className="text-[11px] font-semibold text-terracotta hover:text-[#a85840] cursor-pointer"
            >
              {addTaskBulk ? "Single" : "Bulk"}
            </button>
          </div>
          {addTaskBulk ? (
            <textarea
              value={bulkTaskNames}
              onChange={(e) => setBulkTaskNames(e.target.value)}
              placeholder="One task per line&#10;e.g.&#10;Review applications&#10;Process claims&#10;Update records"
              rows={5}
              className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none focus:border-terracotta resize-none"
            />
          ) : (
            <input
              value={newTaskName}
              onChange={(e) => setNewTaskName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddTask()}
              placeholder="Task name"
              className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none focus:border-terracotta"
              autoFocus
            />
          )}
          <button
            onClick={handleAddTask}
            disabled={addingTask || (addTaskBulk ? !bulkTaskNames.trim() : !newTaskName.trim())}
            className="w-full py-2 rounded-lg bg-terracotta text-white text-sm font-semibold disabled:opacity-50 cursor-pointer hover:bg-[#a85840] transition-colors"
          >
            {addingTask ? "Adding..." : addTaskBulk ? "Add All Tasks" : "Add Task"}
          </button>
        </div>
      )}

      {/* Bulk actions bar */}
      {sortedTasks.length > 0 && (
        <div className="flex items-center gap-3 px-1">
          <label className="flex items-center gap-2 cursor-pointer text-[12px] text-bark select-none">
            <input
              type="checkbox"
              checked={selectedTaskIds.size === sortedTasks.length && sortedTasks.length > 0}
              onChange={() => toggleAllTasks(sortedTasks.map((t) => t.id))}
              className="h-3.5 w-3.5 rounded border-sand text-terracotta accent-terracotta cursor-pointer"
            />
            Select All
          </label>
          {selectedTaskIds.size > 0 && (
            <button
              onClick={handleBulkDeleteTasks}
              disabled={bulkDeletingTasks}
              className="text-[12px] font-semibold text-red-600 hover:text-red-700 cursor-pointer disabled:opacity-50"
            >
              {bulkDeletingTasks ? "Deleting..." : `Delete Selected (${selectedTaskIds.size})`}
            </button>
          )}
        </div>
      )}

      {/* Tasks list */}
      <div className="space-y-2">
        {sortedTasks.map((t, index) => (
          <div
            key={t.id}
            className={`rounded-xl border bg-white p-3 flex items-center gap-3 transition-all ${
              t.is_active ? "border-sand" : "border-sand/50 opacity-50"
            } ${selectedTaskIds.has(t.id) ? "ring-2 ring-terracotta/30" : ""}`}
          >
            {/* Checkbox */}
            <input
              type="checkbox"
              checked={selectedTaskIds.has(t.id)}
              onChange={() => toggleTaskSelection(t.id)}
              className="h-3.5 w-3.5 rounded border-sand text-terracotta accent-terracotta cursor-pointer shrink-0"
            />

            {/* Reorder buttons */}
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => handleMoveTask(index, "up")}
                disabled={index === 0}
                className="text-[10px] text-stone hover:text-espresso disabled:opacity-25 cursor-pointer"
                title="Move up"
              >
                &#9650;
              </button>
              <button
                onClick={() => handleMoveTask(index, "down")}
                disabled={index === sortedTasks.length - 1}
                className="text-[10px] text-stone hover:text-espresso disabled:opacity-25 cursor-pointer"
                title="Move down"
              >
                &#9660;
              </button>
            </div>

            {/* Task name or edit input */}
            <div className="flex-1 min-w-0">
              {editingTaskId === t.id ? (
                <div className="flex items-center gap-2">
                  <input
                    value={editTaskName}
                    onChange={(e) => setEditTaskName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleEditTask(t.id);
                      if (e.key === "Escape") setEditingTaskId(null);
                    }}
                    className="flex-1 rounded border border-terracotta px-2 py-1 text-sm text-espresso outline-none"
                    autoFocus
                  />
                  <button
                    onClick={() => handleEditTask(t.id)}
                    className="text-xs font-semibold text-sage hover:text-[#5a7a5e] cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingTaskId(null)}
                    className="text-xs text-stone hover:text-espresso cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <span className="text-sm text-espresso">{t.task_name}</span>
              )}
            </div>

            {/* Actions */}
            {editingTaskId !== t.id && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => { setEditingTaskId(t.id); setEditTaskName(t.task_name); }}
                  className="p-1.5 rounded-lg text-stone hover:text-espresso hover:bg-parchment cursor-pointer transition-colors"
                  title="Edit name"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  onClick={() => handleToggleTask(t)}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    t.is_active
                      ? "text-sage hover:text-[#5a7a5e] hover:bg-sage-soft"
                      : "text-stone hover:text-espresso hover:bg-parchment"
                  }`}
                  title={t.is_active ? "Deactivate" : "Activate"}
                >
                  {t.is_active ? (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => handleDeleteTask(t)}
                  className="p-1.5 rounded-lg text-stone hover:text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
                  title="Delete task"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
