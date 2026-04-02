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
  account: string | null;
  project_name: string;
  sort_order: number;
  is_active: boolean;
}

interface TaskCategory {
  id: number;
  category_name: string;
  sort_order: number;
  is_active: boolean;
}

interface TaskLibraryItem {
  id: number;
  task_name: string;
  is_active: boolean;
  sort_order: number;
  category_id: number | null;
}

interface ProjectTaskAssignment {
  id: number;
  task_library_id: number;
  project_tag_id: number;
  sort_order: number;
  task_library: TaskLibraryItem;
}

/* ── Icons ───────────────────────────────────────────────── */

const ChevronDown = ({ open }: { open: boolean }) => (
  <svg className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const PlusIcon = () => (
  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const EditIcon = () => (
  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const TrashIcon = () => (
  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
);

const XIcon = () => (
  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const TaskIcon = () => (
  <svg className="h-3.5 w-3.5 text-terracotta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const ProjectIcon = () => (
  <svg className="h-3.5 w-3.5 text-terracotta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
  </svg>
);

const AccountIcon = () => (
  <svg className="h-3.5 w-3.5 text-terracotta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" />
    <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
  </svg>
);

/* ── Component ───────────────────────────────────────────── */

export default function ProjectsTasksTab() {
  /* ── State: data ─────── */
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<ProjectTag[]>([]);
  const [libraryTasks, setLibraryTasks] = useState<TaskLibraryItem[]>([]);
  const [categories, setCategories] = useState<TaskCategory[]>([]);
  const [assignments, setAssignments] = useState<ProjectTaskAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── State: selections ─────── */
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<number>>(new Set());
  const [selectedProject, setSelectedProject] = useState<ProjectTag | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

  /* ── State: collapsed sections ─────── */
  const [collapsedCategories, setCollapsedCategories] = useState<Set<number | "uncategorized">>(new Set());
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<number>>(new Set());
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);

  /* ── State: add forms ─────── */
  const [showAddTask, setShowAddTask] = useState(false);
  const [bulkTaskMode, setBulkTaskMode] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [bulkTaskText, setBulkTaskText] = useState("");
  const [newTaskCategoryId, setNewTaskCategoryId] = useState<number | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [bulkProjectMode, setBulkProjectMode] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [bulkProjectText, setBulkProjectText] = useState("");
  const [addingProject, setAddingProject] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [bulkCategoryTarget, setBulkCategoryTarget] = useState<number | null | "none">("none");

  /* ── State: editing ─────── */
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editTaskName, setEditTaskName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editProjectName, setEditProjectName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editCategoryName, setEditCategoryName] = useState("");

  /* ── State: search ─────── */
  const [taskSearch, setTaskSearch] = useState("");

  /* ── State: busy ─────── */
  const [assigning, setAssigning] = useState(false);

  /* ── Fetch data ─────── */
  const fetchAccounts = useCallback(async () => {
    const res = await fetch("/api/accounts");
    const data = await res.json();
    setAccounts((data.accounts ?? []).filter((a: Account) => a.active));
  }, []);

  const fetchProjects = useCallback(async () => {
    const res = await fetch("/api/project-tags");
    const data = await res.json();
    setProjects(data.projects ?? []);
  }, []);

  const fetchLibraryTasks = useCallback(async () => {
    const res = await fetch("/api/task-library");
    const data = await res.json();
    setLibraryTasks(data.tasks ?? []);
  }, []);

  const fetchCategories = useCallback(async () => {
    const res = await fetch("/api/task-categories");
    const data = await res.json();
    setCategories(data.categories ?? []);
  }, []);

  const fetchAssignments = useCallback(async (projectTagId: number) => {
    const res = await fetch(`/api/project-task-assignments?project_tag_id=${projectTagId}`);
    const data = await res.json();
    setAssignments(data.assignments ?? []);
  }, []);

  useEffect(() => {
    Promise.all([fetchAccounts(), fetchProjects(), fetchLibraryTasks(), fetchCategories()])
      .then(() => setLoading(false));
  }, [fetchAccounts, fetchProjects, fetchLibraryTasks, fetchCategories]);

  useEffect(() => {
    if (selectedProject) {
      fetchAssignments(selectedProject.id);
    } else {
      setAssignments([]);
    }
  }, [selectedProject, fetchAssignments]);

  /* ── Category CRUD ─────── */
  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    setAddingCategory(true);
    const res = await fetch("/api/task-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_name: newCategoryName.trim() }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to add category");
    }
    setNewCategoryName("");
    setShowAddCategory(false);
    setAddingCategory(false);
    fetchCategories();
  };

  const handleEditCategory = async (id: number) => {
    if (!editCategoryName.trim()) return;
    await fetch("/api/task-categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, category_name: editCategoryName.trim() }),
    });
    setEditingCategoryId(null);
    fetchCategories();
  };

  const handleDeleteCategory = async (cat: TaskCategory) => {
    if (!window.confirm(`Delete category "${cat.category_name}"? Tasks in this category will become uncategorized.`)) return;
    await fetch(`/api/task-categories?id=${cat.id}`, { method: "DELETE" });
    fetchCategories();
    fetchLibraryTasks();
  };

  /* ── Task CRUD ─────── */
  const handleAddTask = async () => {
    if (bulkTaskMode) {
      const names = bulkTaskText.split("\n").map((n) => n.trim()).filter(Boolean);
      if (names.length === 0) return;
      setAddingTask(true);
      const res = await fetch("/api/task-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          names,
          ...(newTaskCategoryId ? { category_id: newTaskCategoryId } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to add tasks");
      }
      setBulkTaskText("");
    } else {
      if (!newTaskName.trim()) return;
      setAddingTask(true);
      const res = await fetch("/api/task-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_name: newTaskName.trim(),
          ...(newTaskCategoryId ? { category_id: newTaskCategoryId } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to add task");
      }
      setNewTaskName("");
    }
    setShowAddTask(false);
    setAddingTask(false);
    fetchLibraryTasks();
  };

  const handleEditTask = async (id: number) => {
    if (!editTaskName.trim()) return;
    await fetch("/api/task-library", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, task_name: editTaskName.trim() }),
    });
    setEditingTaskId(null);
    fetchLibraryTasks();
    if (selectedProject) fetchAssignments(selectedProject.id);
  };

  const handleDeleteTask = async (t: TaskLibraryItem) => {
    if (!window.confirm(`Delete "${t.task_name}" from the library? This removes it from ALL projects.`)) return;
    await fetch(`/api/task-library?id=${t.id}`, { method: "DELETE" });
    fetchLibraryTasks();
    if (selectedProject) fetchAssignments(selectedProject.id);
  };

  const handleMoveTaskToCategory = async (taskId: number, categoryId: number | null) => {
    await fetch("/api/task-library", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId, category_id: categoryId }),
    });
    fetchLibraryTasks();
  };

  const handleBulkMoveToCategory = async (categoryId: number | null) => {
    if (selectedTaskIds.size === 0) return;
    setAssigning(true);
    const promises = Array.from(selectedTaskIds).map((taskId) =>
      fetch("/api/task-library", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, category_id: categoryId }),
      })
    );
    await Promise.all(promises);
    setSelectedTaskIds(new Set());
    setBulkCategoryTarget("none");
    setAssigning(false);
    fetchLibraryTasks();
  };

  const handleBulkDeleteTasks = async () => {
    if (selectedTaskIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedTaskIds.size} selected task(s)? This removes them from ALL projects.`)) return;
    setAssigning(true);
    const promises = Array.from(selectedTaskIds).map((id) =>
      fetch(`/api/task-library?id=${id}`, { method: "DELETE" })
    );
    await Promise.all(promises);
    setSelectedTaskIds(new Set());
    setAssigning(false);
    fetchLibraryTasks();
    if (selectedProject) fetchAssignments(selectedProject.id);
  };

  const handleBulkDeleteProjects = async () => {
    if (selectedProjectIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedProjectIds.size} selected project(s)?`)) return;
    setAssigning(true);
    const promises = Array.from(selectedProjectIds).map((id) =>
      fetch(`/api/project-tags?id=${id}`, { method: "DELETE" })
    );
    await Promise.all(promises);
    if (selectedProject && selectedProjectIds.has(selectedProject.id)) setSelectedProject(null);
    setSelectedProjectIds(new Set());
    setAssigning(false);
    fetchProjects();
  };

  const toggleSelectAllInCategory = (categoryId: number | null, tasks: TaskLibraryItem[]) => {
    const taskIds = tasks.map((t) => t.id);
    const allSelected = taskIds.every((id) => selectedTaskIds.has(id));
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        taskIds.forEach((id) => next.delete(id));
      } else {
        taskIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleSelectAllProjects = () => {
    const allSelected = projects.length > 0 && projects.every((p) => selectedProjectIds.has(p.id));
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        projects.forEach((p) => next.delete(p.id));
      } else {
        projects.forEach((p) => next.add(p.id));
      }
      return next;
    });
  };

  /* ── Project CRUD ─────── */
  const handleAddProject = async () => {
    if (bulkProjectMode) {
      const names = bulkProjectText.split("\n").map((n) => n.trim()).filter(Boolean);
      if (names.length === 0) return;
      setAddingProject(true);
      const res = await fetch("/api/project-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to add projects");
      }
      setBulkProjectText("");
    } else {
      if (!newProjectName.trim()) return;
      setAddingProject(true);
      const res = await fetch("/api/project-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_name: newProjectName.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to add project");
      }
      setNewProjectName("");
    }
    setShowAddProject(false);
    setAddingProject(false);
    fetchProjects();
  };

  const handleEditProject = async (id: number) => {
    if (!editProjectName.trim()) return;
    await fetch("/api/project-tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, project_name: editProjectName.trim() }),
    });
    setEditingProjectId(null);
    fetchProjects();
  };

  const handleDeleteProject = async (p: ProjectTag) => {
    if (!window.confirm(`Delete project "${p.project_name}"?`)) return;
    await fetch(`/api/project-tags?id=${p.id}`, { method: "DELETE" });
    if (selectedProject?.id === p.id) setSelectedProject(null);
    fetchProjects();
  };

  /* ── Assignment: tasks → project ─────── */
  const handleAssignTasksToProject = async () => {
    if (!selectedProject || selectedTaskIds.size === 0) return;
    setAssigning(true);
    const alreadyAssigned = new Set(assignments.map((a) => a.task_library_id));
    const toAssign = Array.from(selectedTaskIds).filter((id) => !alreadyAssigned.has(id));
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
    setSelectedTaskIds(new Set());
    setAssigning(false);
    fetchAssignments(selectedProject.id);
  };

  const handleUnassignTask = async (assignmentId: number) => {
    await fetch(`/api/project-task-assignments?id=${assignmentId}`, { method: "DELETE" });
    if (selectedProject) fetchAssignments(selectedProject.id);
  };

  /* ── Assignment: projects → account ─────── */
  const handleAssignProjectsToAccount = async () => {
    if (!selectedAccount || selectedProjectIds.size === 0) return;
    setAssigning(true);
    await fetch("/api/project-tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bulk_assign_account: selectedAccount.name,
        project_ids: Array.from(selectedProjectIds),
      }),
    });
    setSelectedProjectIds(new Set());
    setAssigning(false);
    fetchProjects();
  };

  const handleUnassignProjectFromAccount = async (projectId: number) => {
    await fetch("/api/project-tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projectId, account: null }),
    });
    fetchProjects();
  };

  /* ── Helpers ─────── */
  const toggleTaskSelection = (id: number) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleProjectSelection = (id: number) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleCollapse = (id: number | "uncategorized") => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAccountCollapse = (id: number) => {
    setCollapsedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filteredTasks = taskSearch
    ? libraryTasks.filter((t) => t.task_name.toLowerCase().includes(taskSearch.toLowerCase()))
    : libraryTasks;

  const tasksByCategory = new Map<number | null, TaskLibraryItem[]>();
  filteredTasks.forEach((t) => {
    const key = t.category_id;
    if (!tasksByCategory.has(key)) tasksByCategory.set(key, []);
    tasksByCategory.get(key)!.push(t);
  });

  const assignedTaskIds = new Set(assignments.map((a) => a.task_library_id));
  const sortedAssignments = [...assignments].sort((a, b) => a.sort_order - b.sort_order);

  const projectsByAccount = new Map<string, ProjectTag[]>();
  const unassignedProjects: ProjectTag[] = [];
  projects.forEach((p) => {
    if (p.account) {
      if (!projectsByAccount.has(p.account)) projectsByAccount.set(p.account, []);
      projectsByAccount.get(p.account)!.push(p);
    } else {
      unassignedProjects.push(p);
    }
  });

  /* ── Render ─────── */
  if (loading) {
    return <div className="h-48 animate-pulse rounded-xl border border-sand bg-white" />;
  }

  return (
    <div className="space-y-3">
      {/* Action bar */}
      {selectedTaskIds.size > 0 && (
        <div className="rounded-lg bg-sage-soft border border-sage/30 px-3 py-2 flex items-center gap-2 text-xs flex-wrap">
          <span className="text-sage font-semibold">
            {selectedTaskIds.size} task(s) selected
          </span>
          {selectedProject && (
            <>
              <span className="text-stone">→</span>
              <button
                onClick={handleAssignTasksToProject}
                disabled={assigning}
                className="px-3 py-1 rounded-lg bg-sage text-white font-semibold hover:bg-[#5a7a5e] disabled:opacity-50 cursor-pointer transition-colors"
              >
                {assigning ? "Assigning..." : `Assign to "${selectedProject.project_name}"`}
              </button>
            </>
          )}
          {categories.length > 0 && (
            <>
              <span className="text-stone">|</span>
              <span className="text-stone text-[11px]">Move to:</span>
              <select
                value={bulkCategoryTarget === null ? "__uncategorized__" : bulkCategoryTarget === "none" ? "" : String(bulkCategoryTarget)}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "__uncategorized__") setBulkCategoryTarget(null);
                  else if (val === "") setBulkCategoryTarget("none");
                  else setBulkCategoryTarget(Number(val));
                }}
                className="rounded-lg border border-sage/30 px-2 py-0.5 text-xs text-espresso outline-none bg-white"
              >
                <option value="">Pick category...</option>
                <option value="__uncategorized__">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.category_name}</option>
                ))}
              </select>
              <button
                onClick={() => handleBulkMoveToCategory(bulkCategoryTarget === "none" ? null : bulkCategoryTarget as number | null)}
                disabled={assigning || bulkCategoryTarget === "none"}
                className="px-3 py-1 rounded-lg bg-espresso text-white font-semibold hover:bg-bark disabled:opacity-50 cursor-pointer transition-colors"
              >
                {assigning ? "Moving..." : "Move"}
              </button>
            </>
          )}
          <span className="text-stone">|</span>
          <button
            onClick={handleBulkDeleteTasks}
            disabled={assigning}
            className="px-3 py-1 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 disabled:opacity-50 cursor-pointer transition-colors"
          >
            {assigning ? "Deleting..." : "Delete"}
          </button>
          <button
            onClick={() => setSelectedTaskIds(new Set())}
            className="ml-auto px-2 py-0.5 rounded-lg text-stone hover:text-espresso cursor-pointer text-[11px]"
          >
            Clear
          </button>
        </div>
      )}
      {selectedProjectIds.size > 0 && (
        <div className="rounded-lg bg-terracotta-soft border border-terracotta/30 px-3 py-2 flex items-center gap-2 text-xs flex-wrap">
          <span className="text-terracotta font-semibold">
            {selectedProjectIds.size} project(s) selected
          </span>
          {selectedAccount && (
            <>
              <span className="text-stone">→</span>
              <button
                onClick={handleAssignProjectsToAccount}
                disabled={assigning}
                className="px-3 py-1 rounded-lg bg-terracotta text-white font-semibold hover:bg-[#a85840] disabled:opacity-50 cursor-pointer transition-colors"
              >
                {assigning ? "Assigning..." : `Assign to "${selectedAccount.name}"`}
              </button>
            </>
          )}
          <span className="text-stone">|</span>
          <button
            onClick={handleBulkDeleteProjects}
            disabled={assigning}
            className="px-3 py-1 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 disabled:opacity-50 cursor-pointer transition-colors"
          >
            {assigning ? "Deleting..." : "Delete"}
          </button>
          <button
            onClick={() => setSelectedProjectIds(new Set())}
            className="ml-auto px-2 py-0.5 rounded-lg text-stone hover:text-espresso cursor-pointer text-[11px]"
          >
            Clear
          </button>
        </div>
      )}

      {/* Hint bars */}
      {selectedProjectIds.size > 0 && !selectedAccount && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
          Click an account in the right column to assign the selected projects, or use Delete to remove them.
        </div>
      )}

      {/* Three-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {/* ═══ COLUMN 1: Task Library ═══ */}
        <div className="rounded-xl border border-sand bg-white p-3 space-y-2 max-h-[75vh] overflow-y-auto">
          <div className="flex items-center justify-between sticky top-0 bg-white pb-1 z-10">
            <h3 className="text-xs font-bold text-espresso uppercase tracking-wide flex items-center gap-1.5">
              <TaskIcon />
              Tasks
              <span className="text-stone font-normal normal-case">({libraryTasks.length})</span>
            </h3>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setShowAddCategory(!showAddCategory); setShowAddTask(false); }}
                className="text-[11px] font-semibold text-sage hover:text-[#5a7a5e] cursor-pointer"
                title="Add category"
              >
                + Category
              </button>
              <span className="text-stone text-[10px]">|</span>
              <button
                onClick={() => { setShowAddTask(!showAddTask); setShowAddCategory(false); }}
                className="text-[11px] font-semibold text-terracotta hover:text-[#a85840] cursor-pointer"
              >
                + Task
              </button>
            </div>
          </div>

          {/* Add category form */}
          {showAddCategory && (
            <div className="rounded-lg border border-sand bg-parchment p-2.5 space-y-1.5">
              <span className="text-[11px] font-semibold text-espresso">New Category</span>
              <input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
                placeholder="e.g. Digital Marketing"
                className="w-full rounded-lg border border-sand px-2 py-1 text-xs text-espresso outline-none focus:border-terracotta"
                autoFocus
              />
              <div className="flex gap-1.5">
                <button
                  onClick={handleAddCategory}
                  disabled={addingCategory || !newCategoryName.trim()}
                  className="flex-1 py-1 rounded-lg bg-sage text-white text-xs font-semibold disabled:opacity-50 cursor-pointer hover:bg-[#5a7a5e] transition-colors"
                >
                  {addingCategory ? "Adding..." : "Add"}
                </button>
                <button onClick={() => { setShowAddCategory(false); setNewCategoryName(""); }} className="px-2 py-1 rounded-lg text-xs text-stone hover:text-espresso cursor-pointer">Cancel</button>
              </div>
            </div>
          )}

          {/* Add task form */}
          {showAddTask && (
            <div className="rounded-lg border border-sand bg-parchment p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-espresso">{bulkTaskMode ? "Bulk Add Tasks" : "New Task"}</span>
                <button
                  onClick={() => setBulkTaskMode(!bulkTaskMode)}
                  className="text-[10px] font-semibold text-sage hover:text-[#5a7a5e] cursor-pointer"
                >
                  {bulkTaskMode ? "Single mode" : "Bulk mode"}
                </button>
              </div>
              {bulkTaskMode ? (
                <textarea
                  value={bulkTaskText}
                  onChange={(e) => setBulkTaskText(e.target.value)}
                  placeholder={"Paste task names (one per line):\nTask 1\nTask 2\nTask 3"}
                  rows={5}
                  className="w-full rounded-lg border border-sand px-2 py-1 text-xs text-espresso outline-none focus:border-terracotta resize-y"
                  autoFocus
                />
              ) : (
                <input
                  value={newTaskName}
                  onChange={(e) => setNewTaskName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTask()}
                  placeholder="Task name"
                  className="w-full rounded-lg border border-sand px-2 py-1 text-xs text-espresso outline-none focus:border-terracotta"
                  autoFocus
                />
              )}
              <select
                value={newTaskCategoryId ?? ""}
                onChange={(e) => setNewTaskCategoryId(e.target.value ? Number(e.target.value) : null)}
                className="w-full rounded-lg border border-sand px-2 py-1 text-xs text-espresso outline-none focus:border-terracotta bg-white"
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.category_name}</option>
                ))}
              </select>
              {bulkTaskMode && bulkTaskText.trim() && (
                <p className="text-[10px] text-stone">
                  {bulkTaskText.split("\n").map((n) => n.trim()).filter(Boolean).length} task(s) to add
                </p>
              )}
              <div className="flex gap-1.5">
                <button
                  onClick={handleAddTask}
                  disabled={addingTask || (bulkTaskMode ? !bulkTaskText.trim() : !newTaskName.trim())}
                  className="flex-1 py-1 rounded-lg bg-terracotta text-white text-xs font-semibold disabled:opacity-50 cursor-pointer hover:bg-[#a85840] transition-colors"
                >
                  {addingTask ? "Adding..." : bulkTaskMode ? "Add All" : "Add"}
                </button>
                <button onClick={() => { setShowAddTask(false); setNewTaskName(""); setBulkTaskText(""); }} className="px-2 py-1 rounded-lg text-xs text-stone hover:text-espresso cursor-pointer">Cancel</button>
              </div>
            </div>
          )}

          {/* Search */}
          <input
            value={taskSearch}
            onChange={(e) => setTaskSearch(e.target.value)}
            placeholder="Search tasks..."
            className="w-full rounded-lg border border-sand px-2 py-1 text-xs text-espresso outline-none focus:border-terracotta"
          />

          {/* Categories + tasks */}
          {categories.map((cat) => {
            const catTasks = tasksByCategory.get(cat.id) ?? [];
            const isCollapsed = collapsedCategories.has(cat.id);
            const allCatSelected = catTasks.length > 0 && catTasks.every((t) => selectedTaskIds.has(t.id));
            const someCatSelected = catTasks.some((t) => selectedTaskIds.has(t.id));
            return (
              <div key={cat.id} className="space-y-1">
                <div className="flex items-center gap-1 group">
                  <input
                    type="checkbox"
                    checked={allCatSelected}
                    ref={(el) => { if (el) el.indeterminate = someCatSelected && !allCatSelected; }}
                    onChange={() => toggleSelectAllInCategory(cat.id, catTasks)}
                    className="h-3 w-3 rounded border-sand text-terracotta accent-terracotta cursor-pointer shrink-0"
                    title={`Select all in ${cat.category_name}`}
                  />
                  <button onClick={() => toggleCollapse(cat.id)} className="flex items-center gap-1 flex-1 text-left cursor-pointer py-0.5">
                    <ChevronDown open={!isCollapsed} />
                    {editingCategoryId === cat.id ? (
                      <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          value={editCategoryName}
                          onChange={(e) => setEditCategoryName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleEditCategory(cat.id); if (e.key === "Escape") setEditingCategoryId(null); }}
                          className="flex-1 rounded border border-terracotta px-1.5 py-0.5 text-[11px] text-espresso outline-none"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button onClick={(e) => { e.stopPropagation(); handleEditCategory(cat.id); }} className="text-[10px] font-semibold text-sage cursor-pointer">Save</button>
                        <button onClick={(e) => { e.stopPropagation(); setEditingCategoryId(null); }} className="text-[10px] text-stone cursor-pointer">Cancel</button>
                      </div>
                    ) : (
                      <span className="text-[11px] font-bold text-espresso uppercase tracking-wide flex-1">
                        {cat.category_name}
                        <span className="text-stone font-normal normal-case ml-1">({catTasks.length})</span>
                      </span>
                    )}
                  </button>
                  {editingCategoryId !== cat.id && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingCategoryId(cat.id); setEditCategoryName(cat.category_name); }} className="p-0.5 rounded text-stone hover:text-espresso cursor-pointer" title="Rename"><EditIcon /></button>
                      <button onClick={() => handleDeleteCategory(cat)} className="p-0.5 rounded text-stone hover:text-red-600 cursor-pointer" title="Delete"><TrashIcon /></button>
                    </div>
                  )}
                </div>
                {!isCollapsed && (
                  <div className="space-y-0.5 pl-2">
                    {catTasks.length === 0 ? (
                      <p className="text-[10px] text-stone italic pl-2">No tasks</p>
                    ) : (
                      catTasks.map((t) => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          selected={selectedTaskIds.has(t.id)}
                          assigned={assignedTaskIds.has(t.id) && !!selectedProject}
                          onToggle={() => toggleTaskSelection(t.id)}
                          onEdit={() => { setEditingTaskId(t.id); setEditTaskName(t.task_name); }}
                          onDelete={() => handleDeleteTask(t)}
                          editing={editingTaskId === t.id}
                          editValue={editTaskName}
                          onEditChange={setEditTaskName}
                          onEditSave={() => handleEditTask(t.id)}
                          onEditCancel={() => setEditingTaskId(null)}
                          categories={categories}
                          onMoveToCategory={(catId) => handleMoveTaskToCategory(t.id, catId)}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Uncategorized tasks */}
          {(() => {
            const uncatTasks = tasksByCategory.get(null) ?? [];
            if (uncatTasks.length === 0 && categories.length > 0) return null;
            const isCollapsed = collapsedCategories.has("uncategorized");
            const allUncatSelected = uncatTasks.length > 0 && uncatTasks.every((t) => selectedTaskIds.has(t.id));
            const someUncatSelected = uncatTasks.some((t) => selectedTaskIds.has(t.id));
            return (
              <div className="space-y-1">
                {categories.length > 0 && (
                  <div className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={allUncatSelected}
                      ref={(el) => { if (el) el.indeterminate = someUncatSelected && !allUncatSelected; }}
                      onChange={() => toggleSelectAllInCategory(null, uncatTasks)}
                      className="h-3 w-3 rounded border-sand text-terracotta accent-terracotta cursor-pointer shrink-0"
                      title="Select all uncategorized"
                    />
                    <button onClick={() => toggleCollapse("uncategorized")} className="flex items-center gap-1 cursor-pointer py-0.5 flex-1 text-left">
                      <ChevronDown open={!isCollapsed} />
                      <span className="text-[11px] font-bold text-stone uppercase tracking-wide">
                        Uncategorized
                        <span className="font-normal normal-case ml-1">({uncatTasks.length})</span>
                      </span>
                    </button>
                  </div>
                )}
                {(!isCollapsed || categories.length === 0) && (
                  <div className={`space-y-0.5 ${categories.length > 0 ? "pl-2" : ""}`}>
                    {uncatTasks.length === 0 ? (
                      <p className="text-[11px] text-stone text-center py-3">
                        {taskSearch ? "No tasks match." : "No tasks yet."}
                      </p>
                    ) : (
                      uncatTasks.map((t) => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          selected={selectedTaskIds.has(t.id)}
                          assigned={assignedTaskIds.has(t.id) && !!selectedProject}
                          onToggle={() => toggleTaskSelection(t.id)}
                          onEdit={() => { setEditingTaskId(t.id); setEditTaskName(t.task_name); }}
                          onDelete={() => handleDeleteTask(t)}
                          editing={editingTaskId === t.id}
                          editValue={editTaskName}
                          onEditChange={setEditTaskName}
                          onEditSave={() => handleEditTask(t.id)}
                          onEditCancel={() => setEditingTaskId(null)}
                          categories={categories}
                          onMoveToCategory={(catId) => handleMoveTaskToCategory(t.id, catId)}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* ═══ COLUMN 2: Projects ═══ */}
        <div className="rounded-xl border border-sand bg-white p-3 space-y-2 max-h-[75vh] overflow-y-auto">
          <div className="flex items-center justify-between sticky top-0 bg-white pb-1 z-10">
            <h3 className="text-xs font-bold text-espresso uppercase tracking-wide flex items-center gap-1.5">
              <ProjectIcon />
              Projects
              <span className="text-stone font-normal normal-case">({projects.length})</span>
            </h3>
            <button
              onClick={() => setShowAddProject(!showAddProject)}
              className="text-[11px] font-semibold text-terracotta hover:text-[#a85840] cursor-pointer"
            >
              {showAddProject ? "Cancel" : "+ Add"}
            </button>
          </div>

          {/* Add project form */}
          {showAddProject && (
            <div className="rounded-lg border border-sand bg-parchment p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-espresso">{bulkProjectMode ? "Bulk Add Projects" : "New Project"}</span>
                <button
                  onClick={() => setBulkProjectMode(!bulkProjectMode)}
                  className="text-[10px] font-semibold text-sage hover:text-[#5a7a5e] cursor-pointer"
                >
                  {bulkProjectMode ? "Single mode" : "Bulk mode"}
                </button>
              </div>
              {bulkProjectMode ? (
                <textarea
                  value={bulkProjectText}
                  onChange={(e) => setBulkProjectText(e.target.value)}
                  placeholder={"Paste project names (one per line):\nProject A\nProject B\nProject C"}
                  rows={5}
                  className="w-full rounded-lg border border-sand px-2 py-1 text-xs text-espresso outline-none focus:border-terracotta resize-y"
                  autoFocus
                />
              ) : (
                <input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddProject()}
                  placeholder="Project name"
                  className="w-full rounded-lg border border-sand px-2 py-1 text-xs text-espresso outline-none focus:border-terracotta"
                  autoFocus
                />
              )}
              {bulkProjectMode && bulkProjectText.trim() && (
                <p className="text-[10px] text-stone">
                  {bulkProjectText.split("\n").map((n) => n.trim()).filter(Boolean).length} project(s) to add
                </p>
              )}
              <div className="flex gap-1.5">
                <button
                  onClick={handleAddProject}
                  disabled={addingProject || (bulkProjectMode ? !bulkProjectText.trim() : !newProjectName.trim())}
                  className="flex-1 py-1 rounded-lg bg-terracotta text-white text-xs font-semibold disabled:opacity-50 cursor-pointer hover:bg-[#a85840] transition-colors"
                >
                  {addingProject ? "Adding..." : bulkProjectMode ? "Add All" : "Add"}
                </button>
                <button onClick={() => { setShowAddProject(false); setNewProjectName(""); setBulkProjectText(""); }} className="px-2 py-1 rounded-lg text-xs text-stone hover:text-espresso cursor-pointer">Cancel</button>
              </div>
            </div>
          )}

          {/* All projects list - click to select for task assignment, checkbox for account assignment */}
          <div className="space-y-1">
            {projects.length === 0 ? (
              <p className="text-[11px] text-stone text-center py-4">No projects yet.</p>
            ) : (
              <>
                <div className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={projects.length > 0 && projects.every((p) => selectedProjectIds.has(p.id))}
                    ref={(el) => { if (el) { const some = projects.some((p) => selectedProjectIds.has(p.id)); const all = projects.every((p) => selectedProjectIds.has(p.id)); el.indeterminate = some && !all; } }}
                    onChange={toggleSelectAllProjects}
                    className="h-3 w-3 rounded border-sand text-terracotta accent-terracotta cursor-pointer shrink-0"
                    title="Select all projects"
                  />
                  <button onClick={() => setProjectsCollapsed(!projectsCollapsed)} className="flex items-center gap-1 cursor-pointer py-0.5 flex-1 text-left">
                    <ChevronDown open={!projectsCollapsed} />
                    <span className="text-[11px] font-bold text-stone uppercase tracking-wide">All Projects</span>
                  </button>
                </div>
                {!projectsCollapsed && projects.map((p) => (
                  <div
                    key={p.id}
                    className={`rounded-lg border p-1.5 flex items-center gap-1.5 transition-all text-xs cursor-pointer ${
                      selectedProject?.id === p.id
                        ? "border-terracotta bg-terracotta-soft/30 ring-1 ring-terracotta/30"
                        : "border-sand bg-white hover:border-terracotta/40"
                    } ${selectedProjectIds.has(p.id) ? "ring-2 ring-sage/30" : ""}`}
                    onClick={() => {
                      if (editingProjectId !== p.id) {
                        setSelectedProject(selectedProject?.id === p.id ? null : p);
                      }
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedProjectIds.has(p.id)}
                      onChange={(e) => { e.stopPropagation(); toggleProjectSelection(p.id); }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-3 w-3 rounded border-sand text-terracotta accent-terracotta cursor-pointer shrink-0"
                      title="Select for account assignment"
                    />
                    <div className="flex-1 min-w-0">
                      {editingProjectId === p.id ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
                        <div className="flex items-center gap-1">
                          <span className="font-semibold text-espresso truncate">{p.project_name}</span>
                          {p.account && (
                            <span className="shrink-0 text-[9px] bg-parchment text-bark px-1.5 py-0.5 rounded-full">{p.account}</span>
                          )}
                        </div>
                      )}
                    </div>
                    {editingProjectId !== p.id && (
                      <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => { setEditingProjectId(p.id); setEditProjectName(p.project_name); }} className="p-0.5 rounded text-stone hover:text-espresso cursor-pointer" title="Edit"><EditIcon /></button>
                        <button onClick={() => handleDeleteProject(p)} className="p-0.5 rounded text-stone hover:text-red-600 cursor-pointer" title="Delete"><TrashIcon /></button>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Assigned tasks for selected project */}
          {selectedProject && (
            <div className="border-t border-sand pt-2 space-y-1.5">
              <h4 className="text-[11px] font-bold text-espresso uppercase tracking-wide">
                Tasks in &ldquo;{selectedProject.project_name}&rdquo;
                <span className="text-stone font-normal normal-case ml-1">({sortedAssignments.length})</span>
              </h4>
              {sortedAssignments.length === 0 ? (
                <p className="text-[10px] text-stone text-center py-2 bg-parchment rounded-lg">
                  No tasks assigned. Select tasks on the left and click Assign.
                </p>
              ) : (
                <div className="space-y-0.5">
                  {sortedAssignments.map((a) => (
                    <div key={a.id} className="rounded-lg border border-sand p-1.5 flex items-center gap-1.5 text-xs bg-white">
                      <span className="flex-1 text-espresso truncate">{a.task_library?.task_name ?? "Unknown"}</span>
                      <button
                        onClick={() => handleUnassignTask(a.id)}
                        className="p-0.5 rounded text-stone hover:text-red-600 cursor-pointer shrink-0"
                        title="Remove"
                      >
                        <XIcon />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ═══ COLUMN 3: Accounts ═══ */}
        <div className="rounded-xl border border-sand bg-white p-3 space-y-2 max-h-[75vh] overflow-y-auto">
          <div className="flex items-center justify-between sticky top-0 bg-white pb-1 z-10">
            <h3 className="text-xs font-bold text-espresso uppercase tracking-wide flex items-center gap-1.5">
              <AccountIcon />
              Accounts
              <span className="text-stone font-normal normal-case">({accounts.length})</span>
            </h3>
          </div>

          {/* Accounts list */}
          <div className="space-y-1">
            {accounts.length === 0 ? (
              <p className="text-[11px] text-stone text-center py-4">No accounts.</p>
            ) : (
              accounts.map((acc) => {
                const accProjects = projectsByAccount.get(acc.name) ?? [];
                const isCollapsed = collapsedAccounts.has(acc.id);
                const isSelected = selectedAccount?.id === acc.id;
                return (
                  <div key={acc.id} className="space-y-0.5">
                    <div
                      className={`rounded-lg border p-1.5 flex items-center gap-1.5 transition-all text-xs cursor-pointer ${
                        isSelected
                          ? "border-terracotta bg-terracotta-soft/30 ring-1 ring-terracotta/30"
                          : "border-sand bg-white hover:border-terracotta/40"
                      }`}
                      onClick={() => setSelectedAccount(isSelected ? null : acc)}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleAccountCollapse(acc.id); }}
                        className="shrink-0 cursor-pointer"
                      >
                        <ChevronDown open={!isCollapsed} />
                      </button>
                      <span className="font-semibold text-espresso flex-1 truncate">{acc.name}</span>
                      <span className="text-[9px] text-stone shrink-0">{accProjects.length} project{accProjects.length !== 1 ? "s" : ""}</span>
                    </div>
                    {!isCollapsed && accProjects.length > 0 && (
                      <div className="pl-4 space-y-0.5">
                        {accProjects.map((p) => (
                          <div key={p.id} className="rounded border border-sand/60 p-1 flex items-center gap-1.5 text-[11px] bg-parchment/50">
                            <span className="flex-1 text-bark truncate">{p.project_name}</span>
                            <button
                              onClick={() => handleUnassignProjectFromAccount(p.id)}
                              className="p-0.5 rounded text-stone hover:text-red-600 cursor-pointer shrink-0"
                              title="Remove from account"
                            >
                              <XIcon />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Unassigned projects */}
          {unassignedProjects.length > 0 && (
            <div className="border-t border-sand pt-2 space-y-1">
              <span className="text-[11px] font-bold text-stone uppercase tracking-wide">Unassigned Projects ({unassignedProjects.length})</span>
              <div className="space-y-0.5">
                {unassignedProjects.map((p) => (
                  <div key={p.id} className="rounded border border-dashed border-stone/30 p-1 text-[11px] text-stone truncate">
                    {p.project_name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Task Row Sub-Component ───────────────────────────────── */

function TaskRow({
  task,
  selected,
  assigned,
  onToggle,
  onEdit,
  onDelete,
  editing,
  editValue,
  onEditChange,
  onEditSave,
  onEditCancel,
  categories,
  onMoveToCategory,
}: {
  task: TaskLibraryItem;
  selected: boolean;
  assigned: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  editing: boolean;
  editValue: string;
  onEditChange: (v: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  categories: TaskCategory[];
  onMoveToCategory: (catId: number | null) => void;
}) {
  const [showCatMenu, setShowCatMenu] = useState(false);

  return (
    <div
      className={`rounded-lg border p-1.5 flex items-center gap-1.5 transition-all text-xs ${
        selected ? "border-terracotta/40 bg-terracotta-soft/30 ring-1 ring-terracotta/20" : "border-sand bg-white"
      } ${assigned ? "border-l-2 border-l-sage" : ""}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="h-3 w-3 rounded border-sand text-terracotta accent-terracotta cursor-pointer shrink-0"
      />
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              value={editValue}
              onChange={(e) => onEditChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onEditSave(); if (e.key === "Escape") onEditCancel(); }}
              className="flex-1 rounded border border-terracotta px-1.5 py-0.5 text-xs text-espresso outline-none"
              autoFocus
            />
            <button onClick={onEditSave} className="text-[10px] font-semibold text-sage cursor-pointer">Save</button>
            <button onClick={onEditCancel} className="text-[10px] text-stone cursor-pointer">Cancel</button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-espresso truncate">{task.task_name}</span>
            {assigned && (
              <span className="shrink-0 text-[9px] bg-sage-soft text-sage px-1 py-0.5 rounded-full font-semibold">assigned</span>
            )}
          </div>
        )}
      </div>
      {!editing && (
        <div className="flex items-center gap-0.5 shrink-0 relative">
          {categories.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowCatMenu(!showCatMenu)}
                className="p-0.5 rounded text-stone hover:text-espresso cursor-pointer"
                title="Move to category"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
              </button>
              {showCatMenu && (
                <div className="absolute right-0 top-6 z-20 bg-white border border-sand rounded-lg shadow-lg py-1 min-w-[140px]">
                  <button
                    onClick={() => { onMoveToCategory(null); setShowCatMenu(false); }}
                    className={`w-full text-left px-2.5 py-1 text-[11px] hover:bg-parchment cursor-pointer ${task.category_id === null ? "font-bold text-terracotta" : "text-espresso"}`}
                  >
                    Uncategorized
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { onMoveToCategory(c.id); setShowCatMenu(false); }}
                      className={`w-full text-left px-2.5 py-1 text-[11px] hover:bg-parchment cursor-pointer ${task.category_id === c.id ? "font-bold text-terracotta" : "text-espresso"}`}
                    >
                      {c.category_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={onEdit} className="p-0.5 rounded text-stone hover:text-espresso cursor-pointer" title="Rename"><EditIcon /></button>
          <button onClick={onDelete} className="p-0.5 rounded text-stone hover:text-red-600 cursor-pointer" title="Delete"><TrashIcon /></button>
        </div>
      )}
    </div>
  );
}
