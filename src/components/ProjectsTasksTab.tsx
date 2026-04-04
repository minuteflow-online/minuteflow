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

type BillingType = 'hourly' | 'fixed';

interface TaskLibraryItem {
  id: number;
  task_name: string;
  is_active: boolean;
  sort_order: number;
  category_id: number | null;
  billing_type: BillingType;
  default_rate: number | null;
}

interface ProjectTaskAssignment {
  id: number;
  task_library_id: number;
  project_tag_id: number;
  sort_order: number;
  billing_type: BillingType | null;
  task_rate: number | null;
  task_library: TaskLibraryItem;
}

interface VaProfile {
  id: string;
  full_name: string;
  username: string;
}

interface VaCategoryAssignment {
  id: number;
  va_id: string;
  category_id: number;
  assigned_at: string;
  task_categories: { id: number; category_name: string } | null;
  profiles: { id: string; full_name: string; username: string } | null;
}

interface VaProjectAssignment {
  id: number;
  va_id: string;
  project_tag_id: number;
  billing_type: BillingType;
  rate: number | null;
  assigned_at: string;
  profiles: { id: string; full_name: string; username: string } | null;
  project_tags: { id: number; account: string; project_name: string } | null;
}

interface VaTaskAssignment {
  id: number;
  va_id: string;
  project_task_assignment_id: number;
  billing_type: BillingType;
  rate: number | null;
  assigned_at: string;
  profiles: { id: string; full_name: string; username: string } | null;
  project_task_assignments: {
    id: number;
    task_library_id: number;
    project_tag_id: number;
    billing_type: BillingType | null;
    task_rate: number | null;
    task_library: { id: number; task_name: string } | null;
    project_tags: { id: number; account: string; project_name: string } | null;
  } | null;
}

/* ── Icons ───────────────────────────────────────────────── */

const ChevronDown = ({ open }: { open: boolean }) => (
  <svg className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 9l6 6 6-6" />
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

const AccountIcon = () => (
  <svg className="h-3.5 w-3.5 text-terracotta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" />
    <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
  </svg>
);

const ProjectIcon = () => (
  <svg className="h-3 w-3 text-bark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
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
  const [projectTaskCounts, setProjectTaskCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);

  /* ── State: selections ─────── */
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<number>>(new Set());
  const [selectedProject, setSelectedProject] = useState<ProjectTag | null>(null);

  /* ── State: collapsed sections ─────── */
  const [collapsedCategories, setCollapsedCategories] = useState<Set<number | "uncategorized">>(new Set());
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<number | "unassigned">>(new Set());

  /* ── State: add forms ─────── */
  const [showAddTask, setShowAddTask] = useState(false);
  const [bulkTaskMode, setBulkTaskMode] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [bulkTaskText, setBulkTaskText] = useState("");
  const [newTaskCategoryId, setNewTaskCategoryId] = useState<number | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [bulkCategoryTarget, setBulkCategoryTarget] = useState<number | null | "none">("none");

  /* ── State: add project (per account) ─────── */
  const [addProjectForAccount, setAddProjectForAccount] = useState<string | null>(null);
  const [bulkProjectMode, setBulkProjectMode] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [bulkProjectText, setBulkProjectText] = useState("");
  const [addingProject, setAddingProject] = useState(false);

  /* ── State: editing ─────── */
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editTaskName, setEditTaskName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editProjectName, setEditProjectName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editCategoryName, setEditCategoryName] = useState("");

  /* ── State: billing (add-task) ─────── */
  const [newTaskBillingType, setNewTaskBillingType] = useState<BillingType>("hourly");
  const [newTaskDefaultRate, setNewTaskDefaultRate] = useState("");

  /* ── State: VA category assignments ─────── */
  const [vaList, setVaList] = useState<VaProfile[]>([]);
  const [vaCatAssignments, setVaCatAssignments] = useState<VaCategoryAssignment[]>([]);
  const [selectedCategoryForVA, setSelectedCategoryForVA] = useState<number | null>(null);
  const [assigningVA, setAssigningVA] = useState(false);

  /* ─�� State: VA project/task assignments (NEW) ─────── */
  const [vaProjectAssignments, setVaProjectAssignments] = useState<VaProjectAssignment[]>([]);
  const [vaTaskAssignments, setVaTaskAssignments] = useState<VaTaskAssignment[]>([]);
  const [expandedVAIds, setExpandedVAIds] = useState<Set<string>>(new Set());
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(new Set());
  const [assigningVAToProject, setAssigningVAToProject] = useState(false);
  const [assigningVAToTask, setAssigningVAToTask] = useState(false);
  /* Which project/task is showing VA assign dropdown */
  const [vaAssignDropdownProject, setVaAssignDropdownProject] = useState<number | null>(null);
  const [vaAssignDropdownTask, setVaAssignDropdownTask] = useState<number | null>(null);
  /* All assignments for expanded project tasks */
  const [expandedProjectAssignments, setExpandedProjectAssignments] = useState<Record<number, ProjectTaskAssignment[]>>({});

  /* ── State: selected tasks inside expanded projects (for batch remove) ─────── */
  const [selectedExpandedTaskIds, setSelectedExpandedTaskIds] = useState<Set<number>>(new Set());

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

  const fetchProjectTaskCounts = useCallback(async () => {
    const res = await fetch("/api/project-task-assignments/counts");
    const data = await res.json();
    setProjectTaskCounts(data.counts ?? {});
  }, []);

  const fetchVaList = useCallback(async () => {
    const res = await fetch("/api/profiles?active=true");
    if (res.ok) {
      const data = await res.json();
      setVaList((data.profiles ?? []).map((p: { id: string; full_name: string; username: string }) => ({
        id: p.id,
        full_name: p.full_name,
        username: p.username,
      })));
    }
  }, []);

  const fetchVaCatAssignments = useCallback(async () => {
    const res = await fetch("/api/va-category-assignments");
    if (res.ok) {
      const data = await res.json();
      setVaCatAssignments(data.assignments ?? []);
    }
  }, []);

  const fetchVaProjectAssignments = useCallback(async () => {
    const res = await fetch("/api/va-project-assignments");
    if (res.ok) {
      const data = await res.json();
      setVaProjectAssignments(data.assignments ?? []);
    }
  }, []);

  const fetchVaTaskAssignments = useCallback(async () => {
    const res = await fetch("/api/va-task-assignments");
    if (res.ok) {
      const data = await res.json();
      setVaTaskAssignments(data.assignments ?? []);
    }
  }, []);

  const fetchExpandedProjectTasks = useCallback(async (projectTagId: number) => {
    const res = await fetch(`/api/project-task-assignments?project_tag_id=${projectTagId}`);
    if (res.ok) {
      const data = await res.json();
      setExpandedProjectAssignments((prev) => ({ ...prev, [projectTagId]: data.assignments ?? [] }));
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchAccounts(), fetchProjects(), fetchLibraryTasks(), fetchCategories(), fetchProjectTaskCounts(), fetchVaList(), fetchVaCatAssignments(), fetchVaProjectAssignments(), fetchVaTaskAssignments()])
      .then(() => setLoading(false));
  }, [fetchAccounts, fetchProjects, fetchLibraryTasks, fetchCategories, fetchProjectTaskCounts, fetchVaList, fetchVaCatAssignments, fetchVaProjectAssignments, fetchVaTaskAssignments]);

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
    const billingPayload = {
      billing_type: newTaskBillingType,
      ...(newTaskDefaultRate ? { default_rate: parseFloat(newTaskDefaultRate) } : {}),
    };
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
          ...billingPayload,
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
          ...billingPayload,
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
    setNewTaskBillingType("hourly");
    setNewTaskDefaultRate("");
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

  const toggleSelectAllProjectsInAccount = (accountProjects: ProjectTag[]) => {
    const projectIds = accountProjects.map((p) => p.id);
    const allSelected = projectIds.length > 0 && projectIds.every((id) => selectedProjectIds.has(id));
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        projectIds.forEach((id) => next.delete(id));
      } else {
        projectIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  /* ── Project CRUD ─────── */
  const handleAddProject = async (accountName: string) => {
    if (bulkProjectMode) {
      const names = bulkProjectText.split("\n").map((n) => n.trim()).filter(Boolean);
      if (names.length === 0) return;
      setAddingProject(true);
      const res = await fetch("/api/project-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names, account: accountName }),
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
        body: JSON.stringify({ project_name: newProjectName.trim(), account: accountName }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to add project");
      }
      setNewProjectName("");
    }
    setAddProjectForAccount(null);
    setBulkProjectMode(false);
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
  const handleAssignTasksToProjects = async () => {
    if (selectedProjectIds.size === 0 || selectedTaskIds.size === 0) return;
    setAssigning(true);
    const taskIds = Array.from(selectedTaskIds);
    const projectIds = Array.from(selectedProjectIds);

    try {
      for (const pid of projectIds) {
        // Fetch existing assignments for this project
        const res = await fetch(`/api/project-task-assignments?project_tag_id=${pid}`);
        const data = await res.json();
        const existing = new Set((data.assignments ?? []).map((a: ProjectTaskAssignment) => a.task_library_id));
        const toAssign = taskIds.filter((id) => !existing.has(id));
        if (toAssign.length === 0) continue;

        await fetch("/api/project-task-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_tag_id: pid, task_library_ids: toAssign }),
        });
      }
    } catch (err) {
      alert("Failed to assign tasks to some projects.");
    }

    setSelectedTaskIds(new Set());
    setAssigning(false);
    if (selectedProject) fetchAssignments(selectedProject.id);
    fetchProjectTaskCounts();
  };

  const handleUnassignTask = async (assignmentId: number, projectTagId?: number) => {
    await fetch(`/api/project-task-assignments?id=${assignmentId}`, { method: "DELETE" });
    if (selectedProject) fetchAssignments(selectedProject.id);
    fetchProjectTaskCounts();
    // Refresh expanded project tasks if we know which project
    if (projectTagId && expandedProjectIds.has(projectTagId)) {
      fetchExpandedProjectTasks(projectTagId);
    }
  };

  const handleBulkRemoveTasksFromProject = async (projectTagId: number) => {
    if (selectedExpandedTaskIds.size === 0) return;
    if (!window.confirm(`Remove ${selectedExpandedTaskIds.size} task(s) from this project?`)) return;
    setAssigning(true);
    const promises = Array.from(selectedExpandedTaskIds).map((assignmentId) =>
      fetch(`/api/project-task-assignments?id=${assignmentId}`, { method: "DELETE" })
    );
    await Promise.all(promises);
    setSelectedExpandedTaskIds(new Set());
    setAssigning(false);
    if (selectedProject) fetchAssignments(selectedProject.id);
    fetchProjectTaskCounts();
    if (expandedProjectIds.has(projectTagId)) {
      fetchExpandedProjectTasks(projectTagId);
    }
  };

  const handleMoveProjectToAccount = async (projectId: number, accountName: string | null) => {
    await fetch("/api/project-tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projectId, account: accountName }),
    });
    fetchProjects();
  };

  /* ── VA Category Assignment handlers ─────── */
  const handleAssignVAToCategory = async (vaId: string, categoryId: number) => {
    setAssigningVA(true);
    await fetch("/api/va-category-assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_id: categoryId, va_ids: [vaId] }),
    });
    setAssigningVA(false);
    fetchVaCatAssignments();
  };

  const handleUnassignVAFromCategory = async (assignmentId: number) => {
    await fetch(`/api/va-category-assignments?id=${assignmentId}`, { method: "DELETE" });
    fetchVaCatAssignments();
  };

  /* ── VA Project/Task Assignment handlers (NEW) ─────── */
  const handleAssignVAToProject = async (vaId: string, projectTagId: number) => {
    setAssigningVAToProject(true);
    await fetch("/api/va-project-assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ va_id: vaId, project_tag_id: projectTagId }),
    });
    setAssigningVAToProject(false);
    setVaAssignDropdownProject(null);
    fetchVaProjectAssignments();
  };

  const handleUnassignVAFromProject = async (assignmentId: number) => {
    await fetch(`/api/va-project-assignments?id=${assignmentId}`, { method: "DELETE" });
    fetchVaProjectAssignments();
  };

  const handleAssignVAToTask = async (vaId: string, ptaId: number) => {
    setAssigningVAToTask(true);
    await fetch("/api/va-task-assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ va_id: vaId, project_task_assignment_id: ptaId }),
    });
    setAssigningVAToTask(false);
    setVaAssignDropdownTask(null);
    fetchVaTaskAssignments();
  };

  const handleUnassignVAFromTask = async (assignmentId: number) => {
    await fetch(`/api/va-task-assignments?id=${assignmentId}`, { method: "DELETE" });
    fetchVaTaskAssignments();
  };

  const handleBatchAssignVAToProjects = async (vaId: string) => {
    if (selectedProjectIds.size === 0 || !vaId) return;
    setAssigning(true);
    const projectIds = Array.from(selectedProjectIds);
    // Only assign to projects where this VA isn't already assigned
    const alreadyAssigned = new Set(
      vaProjectAssignments.filter((a) => a.va_id === vaId).map((a) => a.project_tag_id)
    );
    const toAssign = projectIds.filter((pid) => !alreadyAssigned.has(pid));
    const promises = toAssign.map((pid) =>
      fetch("/api/va-project-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ va_id: vaId, project_tag_id: pid }),
      })
    );
    await Promise.all(promises);
    setAssigning(false);
    setSelectedProjectIds(new Set());
    fetchVaProjectAssignments();
  };

  const handleBatchUnassignVAFromProjects = async (vaId: string) => {
    if (selectedProjectIds.size === 0 || !vaId) return;
    setAssigning(true);
    const projectIds = new Set(Array.from(selectedProjectIds));
    const toRemove = vaProjectAssignments.filter((a) => a.va_id === vaId && projectIds.has(a.project_tag_id));
    const promises = toRemove.map((a) =>
      fetch(`/api/va-project-assignments?id=${a.id}`, { method: "DELETE" })
    );
    await Promise.all(promises);
    setAssigning(false);
    setSelectedProjectIds(new Set());
    fetchVaProjectAssignments();
  };

  const handleUpdateVAProjectRate = async (assignmentId: number, billingType?: string, rate?: number | null) => {
    const body: Record<string, unknown> = { id: assignmentId };
    if (billingType !== undefined) body.billing_type = billingType;
    if (rate !== undefined) body.rate = rate;
    await fetch("/api/va-project-assignments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    fetchVaProjectAssignments();
  };

  const handleUpdateVATaskRate = async (assignmentId: number, billingType?: string, rate?: number | null) => {
    const body: Record<string, unknown> = { id: assignmentId };
    if (billingType !== undefined) body.billing_type = billingType;
    if (rate !== undefined) body.rate = rate;
    await fetch("/api/va-task-assignments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    fetchVaTaskAssignments();
  };

  const toggleExpandProject = (projectId: number) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
        // Fetch tasks for this project when expanding
        fetchExpandedProjectTasks(projectId);
      }
      return next;
    });
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

  const toggleAccountCollapse = (id: number | "unassigned") => {
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
      {/* Task action bar */}
      {selectedTaskIds.size > 0 && (
        <div className="rounded-lg bg-sage-soft border border-sage/30 px-3 py-2 flex items-center gap-2 text-xs flex-wrap">
          <span className="text-sage font-semibold">
            {selectedTaskIds.size} task(s) selected
          </span>
          {selectedProjectIds.size > 0 && (
            <>
              <span className="text-stone">→</span>
              <button
                onClick={handleAssignTasksToProjects}
                disabled={assigning}
                className="px-3 py-1 rounded-lg bg-sage text-white font-semibold hover:bg-[#5a7a5e] disabled:opacity-50 cursor-pointer transition-colors"
              >
                {assigning ? "Assigning..." : `Assign to ${selectedProjectIds.size} project(s)`}
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

      {/* Project action bar */}
      {selectedProjectIds.size > 0 && (
        <div className="rounded-lg bg-terracotta-soft border border-terracotta/30 px-3 py-2 flex items-center gap-2 text-xs flex-wrap">
          <span className="text-terracotta font-semibold">
            {selectedProjectIds.size} project(s) selected
          </span>
          {/* Move to account */}
          <span className="text-stone">|</span>
          <span className="text-stone text-[11px]">Move to:</span>
          <select
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              const accountName = val === "__unassigned__" ? null : val;
              setAssigning(true);
              const promises = Array.from(selectedProjectIds).map((id) =>
                fetch("/api/project-tags", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id, account: accountName }),
                })
              );
              Promise.all(promises).then(() => {
                setSelectedProjectIds(new Set());
                setAssigning(false);
                fetchProjects();
              });
            }}
            className="rounded-lg border border-terracotta/30 px-2 py-0.5 text-xs text-espresso outline-none bg-white"
            value=""
          >
            <option value="">Pick account...</option>
            <option value="__unassigned__">Unassigned</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.name}>{a.name}</option>
            ))}
          </select>
          {/* Batch assign VA to selected projects */}
          <span className="text-stone">|</span>
          <span className="text-stone text-[11px]">Assign VA:</span>
          <select
            onChange={(e) => { if (e.target.value) handleBatchAssignVAToProjects(e.target.value); e.target.value = ""; }}
            className="rounded-lg border border-terracotta/30 px-2 py-0.5 text-xs text-espresso outline-none bg-white"
            disabled={assigning}
            value=""
          >
            <option value="">Pick team member...</option>
            {vaList.map((v) => (
              <option key={v.id} value={v.id}>{v.full_name}</option>
            ))}
          </select>
          {/* Batch unassign VA from selected projects */}
          <span className="text-stone text-[11px]">Unassign VA:</span>
          <select
            onChange={(e) => { if (e.target.value) handleBatchUnassignVAFromProjects(e.target.value); e.target.value = ""; }}
            className="rounded-lg border border-terracotta/30 px-2 py-0.5 text-xs text-espresso outline-none bg-white"
            disabled={assigning}
            value=""
          >
            <option value="">Pick team member...</option>
            {vaList.map((v) => (
              <option key={v.id} value={v.id}>{v.full_name}</option>
            ))}
          </select>
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
              {/* Billing type + default rate */}
              <div className="flex gap-2 items-center">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-stone">Billing:</span>
                  <button
                    type="button"
                    onClick={() => setNewTaskBillingType("hourly")}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer transition-colors ${newTaskBillingType === "hourly" ? "bg-sage text-white" : "bg-gray-100 text-stone hover:bg-gray-200"}`}
                  >
                    Hourly
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewTaskBillingType("fixed")}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer transition-colors ${newTaskBillingType === "fixed" ? "bg-terracotta text-white" : "bg-gray-100 text-stone hover:bg-gray-200"}`}
                  >
                    Fixed
                  </button>
                </div>
                <input
                  value={newTaskDefaultRate}
                  onChange={(e) => setNewTaskDefaultRate(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="Default rate"
                  className="w-24 rounded-lg border border-sand px-2 py-0.5 text-[10px] text-espresso outline-none focus:border-terracotta"
                />
              </div>
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

        {/* ═══ COLUMN 2: Accounts & Projects ═══ */}
        <div className="rounded-xl border border-sand bg-white p-3 space-y-2 max-h-[75vh] overflow-y-auto">
          <div className="flex items-center justify-between sticky top-0 bg-white pb-1 z-10">
            <h3 className="text-xs font-bold text-espresso uppercase tracking-wide flex items-center gap-1.5">
              <AccountIcon />
              Accounts & Projects
              <span className="text-stone font-normal normal-case">({accounts.length} accounts, {projects.length} projects)</span>
            </h3>
          </div>

          {/* Accounts list with nested projects */}
          <div className="space-y-2">
            {accounts.length === 0 ? (
              <p className="text-[11px] text-stone text-center py-4">No accounts.</p>
            ) : (
              accounts.map((acc) => {
                const accProjects = projectsByAccount.get(acc.name) ?? [];
                const isCollapsed = collapsedAccounts.has(acc.id);
                const allProjectsSelected = accProjects.length > 0 && accProjects.every((p) => selectedProjectIds.has(p.id));
                const someProjectsSelected = accProjects.some((p) => selectedProjectIds.has(p.id));
                const isAddingHere = addProjectForAccount === acc.name;
                return (
                  <div key={acc.id} className="rounded-lg border border-sand overflow-hidden">
                    {/* Account header */}
                    <div className="bg-parchment/60 px-2.5 py-1.5 flex items-center gap-1.5 text-xs">
                      {accProjects.length > 0 && (
                        <input
                          type="checkbox"
                          checked={allProjectsSelected}
                          ref={(el) => { if (el) el.indeterminate = someProjectsSelected && !allProjectsSelected; }}
                          onChange={() => toggleSelectAllProjectsInAccount(accProjects)}
                          className="h-3 w-3 rounded border-sand text-terracotta accent-terracotta cursor-pointer shrink-0"
                          title={`Select all projects in ${acc.name}`}
                        />
                      )}
                      <button
                        onClick={() => toggleAccountCollapse(acc.id)}
                        className="flex items-center gap-1 flex-1 text-left cursor-pointer"
                      >
                        <ChevronDown open={!isCollapsed} />
                        <span className="font-bold text-espresso">{acc.name}</span>
                        <span className="text-[10px] text-stone font-normal">
                          ({accProjects.length} project{accProjects.length !== 1 ? "s" : ""})
                        </span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isAddingHere) {
                            setAddProjectForAccount(null);
                            setNewProjectName("");
                            setBulkProjectText("");
                            setBulkProjectMode(false);
                          } else {
                            setAddProjectForAccount(acc.name);
                            setNewProjectName("");
                            setBulkProjectText("");
                            setBulkProjectMode(false);
                          }
                        }}
                        className="text-[10px] font-semibold text-terracotta hover:text-[#a85840] cursor-pointer shrink-0"
                      >
                        {isAddingHere ? "Cancel" : "+ Project"}
                      </button>
                    </div>

                    {/* Add project form (inline under this account) */}
                    {isAddingHere && (
                      <div className="border-t border-sand bg-parchment/30 px-2.5 py-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-espresso">{bulkProjectMode ? "Bulk Add" : "New Project"}</span>
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
                            placeholder={"Paste project names (one per line):\nProject A\nProject B"}
                            rows={4}
                            className="w-full rounded-lg border border-sand px-2 py-1 text-xs text-espresso outline-none focus:border-terracotta resize-y"
                            autoFocus
                          />
                        ) : (
                          <input
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleAddProject(acc.name)}
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
                            onClick={() => handleAddProject(acc.name)}
                            disabled={addingProject || (bulkProjectMode ? !bulkProjectText.trim() : !newProjectName.trim())}
                            className="flex-1 py-1 rounded-lg bg-terracotta text-white text-xs font-semibold disabled:opacity-50 cursor-pointer hover:bg-[#a85840] transition-colors"
                          >
                            {addingProject ? "Adding..." : bulkProjectMode ? "Add All" : "Add"}
                          </button>
                          <button onClick={() => { setAddProjectForAccount(null); setNewProjectName(""); setBulkProjectText(""); setBulkProjectMode(false); }} className="px-2 py-1 rounded-lg text-xs text-stone hover:text-espresso cursor-pointer">Cancel</button>
                        </div>
                      </div>
                    )}

                    {/* Projects list under this account (expandable) */}
                    {!isCollapsed && accProjects.length > 0 && (
                      <div className="border-t border-sand divide-y divide-sand/50">
                        {accProjects.map((p) => {
                          const isExpanded = expandedProjectIds.has(p.id);
                          const projectTasks = expandedProjectAssignments[p.id] ?? [];
                          const projectVAs = vaProjectAssignments.filter((a) => a.project_tag_id === p.id);
                          return (
                            <div key={p.id}>
                              <div className="flex items-center">
                                <div className="flex-1">
                                  <ProjectRow
                                    project={p}
                                    selected={selectedProjectIds.has(p.id)}
                                    isActiveProject={selectedProject?.id === p.id}
                                    onToggleSelect={() => toggleProjectSelection(p.id)}
                                    onClickProject={() => toggleExpandProject(p.id)}
                                    onEdit={() => { setEditingProjectId(p.id); setEditProjectName(p.project_name); }}
                                    onDelete={() => handleDeleteProject(p)}
                                    editing={editingProjectId === p.id}
                                    editValue={editProjectName}
                                    onEditChange={setEditProjectName}
                                    onEditSave={() => handleEditProject(p.id)}
                                    onEditCancel={() => setEditingProjectId(null)}
                                    accounts={accounts}
                                    onMoveToAccount={(accName) => handleMoveProjectToAccount(p.id, accName)}
                                    taskCount={projectTaskCounts[p.id] ?? 0}
                                    isExpanded={isExpanded}
                                  />
                                </div>
                                {/* VA assign button for project */}
                                <div className="relative shrink-0 pr-2" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => setVaAssignDropdownProject(vaAssignDropdownProject === p.id ? null : p.id)}
                                    className="text-[9px] font-semibold text-sage hover:text-[#5a7a5e] cursor-pointer px-1.5 py-0.5 rounded bg-sage-soft/50 hover:bg-sage-soft"
                                    title="Assign VA"
                                  >
                                    {projectVAs.length > 0 ? `👤 ${projectVAs.length}` : "+ VA"}
                                  </button>
                                  {vaAssignDropdownProject === p.id && (
                                    <div className="absolute right-0 top-6 z-30 bg-white border border-sand rounded-lg shadow-lg py-1 min-w-[160px]">
                                      <div className="px-2 py-1 text-[10px] font-bold text-espresso border-b border-sand">Assign VA to Project</div>
                                      {/* Show currently assigned VAs */}
                                      {projectVAs.map((va) => (
                                        <div key={va.id} className="px-2 py-1 flex items-center justify-between text-[11px]">
                                          <span className="text-sage font-semibold">{va.profiles?.full_name ?? "Unknown"}</span>
                                          <button onClick={() => handleUnassignVAFromProject(va.id)} className="text-red-400 hover:text-red-600 cursor-pointer text-[9px]">Remove</button>
                                        </div>
                                      ))}
                                      {/* Add new VA */}
                                      {vaList.filter((v) => !projectVAs.some((pv) => pv.va_id === v.id)).length > 0 && (
                                        <select
                                          onChange={(e) => { if (e.target.value) handleAssignVAToProject(e.target.value, p.id); e.target.value = ""; }}
                                          className="mx-1.5 my-1 rounded border border-sand px-1.5 py-0.5 text-[10px] text-espresso outline-none bg-white cursor-pointer w-[calc(100%-12px)]"
                                          disabled={assigningVAToProject}
                                          value=""
                                        >
                                          <option value="">Add VA...</option>
                                          {vaList.filter((v) => !projectVAs.some((pv) => pv.va_id === v.id)).map((v) => (
                                            <option key={v.id} value={v.id}>{v.full_name}</option>
                                          ))}
                                        </select>
                                      )}
                                      <button onClick={() => setVaAssignDropdownProject(null)} className="w-full text-center text-[10px] text-stone hover:text-espresso cursor-pointer py-1 border-t border-sand">Close</button>
                                    </div>
                                  )}
                                </div>
                              </div>
                              {/* Expanded tasks inside project */}
                              {isExpanded && (
                                <div className="pl-8 pr-2 pb-2 space-y-0.5 bg-parchment/30">
                                  {projectTasks.length === 0 ? (
                                    <p className="text-[10px] text-stone italic py-1">No tasks assigned to this project yet.</p>
                                  ) : (
                                    <>
                                      {/* Select all + batch action bar */}
                                      {(() => {
                                        const thisProjectTaskIds = projectTasks.map((a) => a.id);
                                        const selectedInThisProject = thisProjectTaskIds.filter((id) => selectedExpandedTaskIds.has(id));
                                        const allSelected = thisProjectTaskIds.length > 0 && selectedInThisProject.length === thisProjectTaskIds.length;
                                        const someSelected = selectedInThisProject.length > 0;
                                        return (
                                          <div className="flex items-center gap-1.5 py-1 px-1">
                                            <input
                                              type="checkbox"
                                              checked={allSelected}
                                              ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                                              onChange={() => {
                                                setSelectedExpandedTaskIds((prev) => {
                                                  const next = new Set(prev);
                                                  if (allSelected) {
                                                    thisProjectTaskIds.forEach((id) => next.delete(id));
                                                  } else {
                                                    thisProjectTaskIds.forEach((id) => next.add(id));
                                                  }
                                                  return next;
                                                });
                                              }}
                                              className="h-3 w-3 rounded border-sand text-terracotta accent-terracotta cursor-pointer shrink-0"
                                              title="Select all tasks in this project"
                                            />
                                            <span className="text-[10px] text-stone">
                                              {someSelected ? `${selectedInThisProject.length} selected` : "Select all"}
                                            </span>
                                            {someSelected && (
                                              <>
                                                <button
                                                  onClick={() => handleBulkRemoveTasksFromProject(p.id)}
                                                  disabled={assigning}
                                                  className="ml-auto px-2 py-0.5 rounded bg-red-500 text-white text-[10px] font-semibold hover:bg-red-600 disabled:opacity-50 cursor-pointer transition-colors"
                                                >
                                                  {assigning ? "Removing..." : `Remove ${selectedInThisProject.length}`}
                                                </button>
                                                <button
                                                  onClick={() => {
                                                    setSelectedExpandedTaskIds((prev) => {
                                                      const next = new Set(prev);
                                                      thisProjectTaskIds.forEach((id) => next.delete(id));
                                                      return next;
                                                    });
                                                  }}
                                                  className="px-1.5 py-0.5 rounded text-[10px] text-stone hover:text-espresso cursor-pointer"
                                                >
                                                  Clear
                                                </button>
                                              </>
                                            )}
                                          </div>
                                        );
                                      })()}
                                      {projectTasks.map((a) => {
                                        const taskVAs = vaTaskAssignments.filter((vta) => vta.project_task_assignment_id === a.id);
                                        return (
                                          <div key={a.id} className="rounded border border-sand/60 bg-white p-1.5 text-[11px]">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <input
                                                type="checkbox"
                                                checked={selectedExpandedTaskIds.has(a.id)}
                                                onChange={() => {
                                                  setSelectedExpandedTaskIds((prev) => {
                                                    const next = new Set(prev);
                                                    if (next.has(a.id)) next.delete(a.id);
                                                    else next.add(a.id);
                                                    return next;
                                                  });
                                                }}
                                                className="h-3 w-3 rounded border-sand text-terracotta accent-terracotta cursor-pointer shrink-0"
                                              />
                                              <span className="text-espresso truncate flex-1">{a.task_library?.task_name ?? "Unknown"}</span>
                                              {/* VA badges */}
                                              {taskVAs.map((tv) => (
                                                <span key={tv.id} className="text-[9px] bg-sage-soft text-sage px-1 py-0.5 rounded-full font-semibold flex items-center gap-0.5 shrink-0">
                                                  {tv.profiles?.full_name?.split(" ")[0] ?? "VA"}
                                                  <button onClick={() => handleUnassignVAFromTask(tv.id)} className="hover:text-red-600 cursor-pointer"><XIcon /></button>
                                                </span>
                                              ))}
                                              {/* Assign VA to this task */}
                                              <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                  onClick={() => setVaAssignDropdownTask(vaAssignDropdownTask === a.id ? null : a.id)}
                                                  className="text-[9px] text-sage hover:text-[#5a7a5e] cursor-pointer px-1 py-0.5 rounded bg-sage-soft/30 hover:bg-sage-soft"
                                                >
                                                  + VA
                                                </button>
                                                {vaAssignDropdownTask === a.id && (
                                                  <div className="absolute right-0 bottom-full mb-1 z-30 bg-white border border-sand rounded-lg shadow-lg py-1 min-w-[140px]">
                                                    {vaList.filter((v) => !taskVAs.some((tv) => tv.va_id === v.id)).map((v) => (
                                                      <button
                                                        key={v.id}
                                                        onClick={() => handleAssignVAToTask(v.id, a.id)}
                                                        className="w-full text-left px-2 py-1 text-[11px] text-espresso hover:bg-parchment cursor-pointer"
                                                        disabled={assigningVAToTask}
                                                      >
                                                        {v.full_name}
                                                      </button>
                                                    ))}
                                                    <button onClick={() => setVaAssignDropdownTask(null)} className="w-full text-center text-[10px] text-stone hover:text-espresso cursor-pointer py-1 border-t border-sand">Close</button>
                                                  </div>
                                                )}
                                              </div>
                                              {/* Remove task from project */}
                                              <button
                                                onClick={() => handleUnassignTask(a.id, p.id)}
                                                className="p-0.5 rounded text-stone hover:text-red-600 cursor-pointer shrink-0"
                                                title="Remove task from project"
                                              >
                                                <XIcon />
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* No projects message */}
                    {!isCollapsed && accProjects.length === 0 && !isAddingHere && (
                      <div className="border-t border-sand px-2.5 py-2">
                        <p className="text-[10px] text-stone italic">No projects yet</p>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* Unassigned projects */}
            {unassignedProjects.length > 0 && (
              <div className="rounded-lg border border-dashed border-stone/30 overflow-hidden">
                <div className="bg-stone/5 px-2.5 py-1.5 flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={unassignedProjects.every((p) => selectedProjectIds.has(p.id))}
                    ref={(el) => {
                      if (el) {
                        const some = unassignedProjects.some((p) => selectedProjectIds.has(p.id));
                        const all = unassignedProjects.every((p) => selectedProjectIds.has(p.id));
                        el.indeterminate = some && !all;
                      }
                    }}
                    onChange={() => toggleSelectAllProjectsInAccount(unassignedProjects)}
                    className="h-3 w-3 rounded border-sand text-terracotta accent-terracotta cursor-pointer shrink-0"
                    title="Select all unassigned projects"
                  />
                  <button
                    onClick={() => toggleAccountCollapse("unassigned")}
                    className="flex items-center gap-1 flex-1 text-left cursor-pointer"
                  >
                    <ChevronDown open={!collapsedAccounts.has("unassigned")} />
                    <span className="font-bold text-stone">Unassigned</span>
                    <span className="text-[10px] text-stone font-normal">
                      ({unassignedProjects.length} project{unassignedProjects.length !== 1 ? "s" : ""})
                    </span>
                  </button>
                </div>
                {!collapsedAccounts.has("unassigned") && (
                  <div className="divide-y divide-stone/10">
                    {unassignedProjects.map((p) => (
                      <ProjectRow
                        key={p.id}
                        project={p}
                        selected={selectedProjectIds.has(p.id)}
                        isActiveProject={selectedProject?.id === p.id}
                        onToggleSelect={() => toggleProjectSelection(p.id)}
                        onClickProject={() => toggleExpandProject(p.id)}
                        onEdit={() => { setEditingProjectId(p.id); setEditProjectName(p.project_name); }}
                        onDelete={() => handleDeleteProject(p)}
                        editing={editingProjectId === p.id}
                        editValue={editProjectName}
                        onEditChange={setEditProjectName}
                        onEditSave={() => handleEditProject(p.id)}
                        onEditCancel={() => setEditingProjectId(null)}
                        accounts={accounts}
                        onMoveToAccount={(accName) => handleMoveProjectToAccount(p.id, accName)}
                        taskCount={projectTaskCounts[p.id] ?? 0}
                        isExpanded={expandedProjectIds.has(p.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Assigned tasks for selected project */}
          {selectedProject && (
            <div className="border-t border-sand pt-2 space-y-1.5">
              <h4 className="text-[11px] font-bold text-espresso uppercase tracking-wide">
                Tasks in &ldquo;{selectedProject.project_name}&rdquo;
                <span className="text-stone font-normal normal-case ml-1">({sortedAssignments.length})</span>
              </h4>
              <p className="text-[10px] text-stone">Select tasks on the left, then click &ldquo;Assign&rdquo; in the action bar. Hover a row to set billing type &amp; rate override.</p>
              {sortedAssignments.length === 0 ? (
                <p className="text-[10px] text-stone text-center py-2 bg-parchment rounded-lg">
                  No tasks assigned yet.
                </p>
              ) : (
                <div className="space-y-0.5">
                  {sortedAssignments.map((a) => {
                    const effectiveBilling = a.billing_type ?? a.task_library?.billing_type ?? "hourly";
                    const effectiveRate = a.task_rate ?? a.task_library?.default_rate ?? null;
                    return (
                      <div key={a.id} className="rounded-lg border border-sand p-1.5 flex items-center gap-1.5 text-xs bg-white group">
                        <span className="flex-1 text-espresso truncate">{a.task_library?.task_name ?? "Unknown"}</span>
                        {/* Billing badge */}
                        <span className={`shrink-0 text-[9px] px-1 py-0.5 rounded-full font-semibold ${effectiveBilling === "fixed" ? "bg-terracotta-soft text-terracotta" : "bg-gray-100 text-stone"}`}>
                          {effectiveBilling === "fixed" ? (effectiveRate ? `$${effectiveRate}` : "Fixed") : "Hourly"}
                        </span>
                        {/* Inline rate override */}
                        <input
                          type="text"
                          placeholder="Rate"
                          defaultValue={a.task_rate ?? ""}
                          className="w-14 rounded border border-sand px-1 py-0.5 text-[10px] text-espresso outline-none focus:border-terracotta opacity-0 group-hover:opacity-100 transition-opacity"
                          onBlur={async (e) => {
                            const val = e.target.value.trim();
                            const rate = val ? parseFloat(val) : null;
                            if (rate === a.task_rate) return;
                            await fetch("/api/project-task-assignments", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: a.id, task_rate: rate }),
                            });
                            if (selectedProject) fetchAssignments(selectedProject.id);
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <select
                          value={a.billing_type ?? ""}
                          onChange={async (e) => {
                            const val = e.target.value || null;
                            await fetch("/api/project-task-assignments", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: a.id, billing_type: val }),
                            });
                            if (selectedProject) fetchAssignments(selectedProject.id);
                          }}
                          className="rounded border border-sand px-1 py-0.5 text-[10px] text-espresso outline-none bg-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        >
                          <option value="">Inherit</option>
                          <option value="hourly">Hourly</option>
                          <option value="fixed">Fixed</option>
                        </select>
                        <button
                          onClick={() => handleUnassignTask(a.id)}
                          className="p-0.5 rounded text-stone hover:text-red-600 cursor-pointer shrink-0"
                          title="Remove"
                        >
                          <XIcon />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ═══ COLUMN 3: VA Assignments & Rates ═══ */}
        <div className="rounded-xl border border-sand bg-white p-3 space-y-2 max-h-[75vh] overflow-y-auto">
          <div className="flex items-center justify-between sticky top-0 bg-white pb-1 z-10">
            <h3 className="text-xs font-bold text-espresso uppercase tracking-wide flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5 text-terracotta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87" />
                <path d="M16 3.13a4 4 0 010 7.75" />
              </svg>
              Team
            </h3>
          </div>

          {/* Expandable list of all team members */}
          <div className="space-y-1">
            {vaList.map((va) => {
              const isExpanded = expandedVAIds.has(va.id);
              const myProjectAssignments = vaProjectAssignments.filter((a) => a.va_id === va.id);
              const myTaskAssignments = vaTaskAssignments.filter((a) => a.va_id === va.id);
              const totalAssignments = myProjectAssignments.length + myTaskAssignments.length;

              // Group task assignments by project
              const tasksByProjectId = new Map<number, VaTaskAssignment[]>();
              for (const ta of myTaskAssignments) {
                const ptId = ta.project_task_assignments?.project_tag_id;
                if (ptId !== undefined && ptId !== null) {
                  if (!tasksByProjectId.has(ptId)) tasksByProjectId.set(ptId, []);
                  tasksByProjectId.get(ptId)!.push(ta);
                }
              }

              // Collect all project IDs
              const allProjectIds = new Set<number>();
              myProjectAssignments.forEach((a) => allProjectIds.add(a.project_tag_id));
              myTaskAssignments.forEach((a) => {
                const ptId = a.project_task_assignments?.project_tag_id;
                if (ptId !== undefined && ptId !== null) allProjectIds.add(ptId);
              });

              return (
                <div key={va.id} className="rounded-lg border border-sand overflow-hidden">
                  {/* VA row - click to expand */}
                  <button
                    onClick={() => {
                      setExpandedVAIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(va.id)) next.delete(va.id); else next.add(va.id);
                        return next;
                      });
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 bg-parchment/40 hover:bg-parchment/70 transition-colors cursor-pointer"
                  >
                    <ChevronDown open={isExpanded} />
                    <svg className="h-3.5 w-3.5 text-sage shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    <span className="text-[11px] font-semibold text-espresso flex-1 text-left truncate">{va.full_name}</span>
                    {totalAssignments > 0 && (
                      <span className="text-[9px] bg-sage-soft text-sage px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                        {totalAssignments}
                      </span>
                    )}
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="border-t border-sand bg-white p-2 space-y-2">
                      {allProjectIds.size === 0 ? (
                        <p className="text-[10px] text-stone text-center py-3 bg-parchment/30 rounded-lg">
                          No assignments yet. Assign from Accounts &amp; Projects.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {Array.from(allProjectIds).map((projectId) => {
                            const projAssignment = myProjectAssignments.find((a) => a.project_tag_id === projectId);
                            const projTasks = tasksByProjectId.get(projectId) ?? [];
                            const projectInfo = projAssignment?.project_tags ?? projTasks[0]?.project_task_assignments?.project_tags;
                            const projectName = projectInfo?.project_name ?? "Unknown Project";
                            const accountName = projectInfo?.account ?? "Unknown Account";

                            return (
                              <div key={projectId} className="rounded-lg border border-sand/80 overflow-hidden">
                                {/* Project header */}
                                <div className="bg-parchment/40 px-2 py-1.5 space-y-1">
                                  <div className="flex items-center gap-1.5">
                                    <ProjectIcon />
                                    <div className="flex-1 min-w-0">
                                      <span className="text-[11px] font-semibold text-espresso truncate block">{projectName}</span>
                                      <span className="text-[9px] text-stone">{accountName}</span>
                                    </div>
                                    {projAssignment && (
                                      <span className="text-[9px] bg-sage-soft text-sage px-1 py-0.5 rounded-full font-semibold shrink-0">Project</span>
                                    )}
                                  </div>
                                  {/* Project-level rate controls */}
                                  {projAssignment && (
                                    <div className="flex items-center gap-1.5 mt-1">
                                      <select
                                        value={projAssignment.billing_type}
                                        onChange={(e) => handleUpdateVAProjectRate(projAssignment.id, e.target.value)}
                                        className="rounded border border-sand px-1 py-0.5 text-[10px] text-espresso outline-none bg-white cursor-pointer"
                                      >
                                        <option value="hourly">Hourly</option>
                                        <option value="fixed">Fixed</option>
                                      </select>
                                      <input
                                        type="text"
                                        placeholder="Rate"
                                        defaultValue={projAssignment.rate ?? ""}
                                        key={`proj-rate-${projAssignment.id}-${projAssignment.rate}`}
                                        className="w-16 rounded border border-sand px-1 py-0.5 text-[10px] text-espresso outline-none focus:border-terracotta"
                                        onBlur={(e) => {
                                          const val = e.target.value.trim();
                                          const rate = val ? parseFloat(val) : null;
                                          if (rate !== projAssignment.rate) handleUpdateVAProjectRate(projAssignment.id, undefined, rate);
                                        }}
                                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                      />
                                      <button
                                        onClick={() => handleUnassignVAFromProject(projAssignment.id)}
                                        className="p-0.5 rounded text-stone hover:text-red-600 cursor-pointer ml-auto"
                                        title="Unassign from project"
                                      >
                                        <XIcon />
                                      </button>
                                    </div>
                                  )}
                                </div>
                                {/* Task assignments */}
                                {projTasks.length > 0 && (
                                  <div className="border-t border-sand divide-y divide-sand/50">
                                    {projTasks.map((ta) => {
                                      const taskName = ta.project_task_assignments?.task_library?.task_name ?? "Unknown Task";
                                      return (
                                        <div key={ta.id} className="px-2 py-1.5 flex items-center gap-1.5 text-[11px]">
                                          <span className="flex-1 text-espresso truncate pl-3">{taskName}</span>
                                          <select
                                            value={ta.billing_type}
                                            onChange={(e) => handleUpdateVATaskRate(ta.id, e.target.value)}
                                            className="rounded border border-sand px-1 py-0.5 text-[10px] text-espresso outline-none bg-white cursor-pointer"
                                          >
                                            <option value="hourly">Hourly</option>
                                            <option value="fixed">Fixed</option>
                                          </select>
                                          <input
                                            type="text"
                                            placeholder="Rate"
                                            defaultValue={ta.rate ?? ""}
                                            key={`task-rate-${ta.id}-${ta.rate}`}
                                            className="w-14 rounded border border-sand px-1 py-0.5 text-[10px] text-espresso outline-none focus:border-terracotta"
                                            onBlur={(e) => {
                                              const val = e.target.value.trim();
                                              const rate = val ? parseFloat(val) : null;
                                              if (rate !== ta.rate) handleUpdateVATaskRate(ta.id, undefined, rate);
                                            }}
                                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                          />
                                          <button
                                            onClick={() => handleUnassignVAFromTask(ta.id)}
                                            className="p-0.5 rounded text-stone hover:text-red-600 cursor-pointer shrink-0"
                                            title="Unassign task"
                                          >
                                            <XIcon />
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══ VA Category Assignments ═══ */}
      <div className="rounded-xl border border-sand bg-white p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-espresso uppercase tracking-wide flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5 text-terracotta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87" />
              <path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
            VA Assignments
            <span className="text-stone font-normal normal-case">
              ({vaCatAssignments.length} assignment{vaCatAssignments.length !== 1 ? "s" : ""})
            </span>
          </h3>
        </div>
        <p className="text-[10px] text-stone">
          Assign VAs to task categories. VAs will only see tasks from their assigned categories.
        </p>

        {/* Category selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-espresso font-semibold">Category:</span>
          {categories.map((cat) => {
            const count = vaCatAssignments.filter((a) => a.category_id === cat.id).length;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategoryForVA(selectedCategoryForVA === cat.id ? null : cat.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                  selectedCategoryForVA === cat.id
                    ? "bg-terracotta text-white"
                    : "bg-parchment text-espresso hover:bg-sand"
                }`}
              >
                {cat.category_name}
                {count > 0 && (
                  <span className={`ml-1 text-[9px] ${selectedCategoryForVA === cat.id ? "text-white/80" : "text-stone"}`}>
                    ({count} VA{count !== 1 ? "s" : ""})
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* VA list for selected category */}
        {selectedCategoryForVA && (() => {
          const catName = categories.find((c) => c.id === selectedCategoryForVA)?.category_name ?? "Category";
          const assignedVaIds = new Set(
            vaCatAssignments
              .filter((a) => a.category_id === selectedCategoryForVA)
              .map((a) => a.va_id)
          );
          const assignedList = vaCatAssignments.filter((a) => a.category_id === selectedCategoryForVA);
          const unassignedVAs = vaList.filter((v) => !assignedVaIds.has(v.id));
          return (
            <div className="rounded-lg border border-sand p-2.5 space-y-2">
              <h4 className="text-[11px] font-bold text-espresso">
                VAs assigned to &ldquo;{catName}&rdquo;
              </h4>

              {/* Currently assigned */}
              {assignedList.length === 0 ? (
                <p className="text-[10px] text-stone italic">No VAs assigned yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {assignedList.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1 bg-sage-soft text-sage px-2 py-0.5 rounded-full text-[11px] font-semibold">
                      {a.profiles?.full_name ?? a.profiles?.username ?? "Unknown"}
                      <button
                        onClick={() => handleUnassignVAFromCategory(a.id)}
                        className="hover:text-red-600 cursor-pointer"
                        title="Remove"
                      >
                        <XIcon />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Add VA */}
              {unassignedVAs.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-stone">Add VA:</span>
                  <select
                    onChange={(e) => {
                      const vaId = e.target.value;
                      if (!vaId) return;
                      handleAssignVAToCategory(vaId, selectedCategoryForVA);
                      e.target.value = "";
                    }}
                    className="rounded-lg border border-sand px-2 py-0.5 text-[11px] text-espresso outline-none bg-white cursor-pointer"
                    disabled={assigningVA}
                    value=""
                  >
                    <option value="">Select VA...</option>
                    {unassignedVAs.map((v) => (
                      <option key={v.id} value={v.id}>{v.full_name}</option>
                    ))}
                  </select>
                  {assigningVA && <span className="text-[10px] text-stone animate-pulse">Assigning...</span>}
                </div>
              )}
            </div>
          );
        })()}

        {/* Summary: all assignments grouped by VA */}
        {vaCatAssignments.length > 0 && !selectedCategoryForVA && (
          <div className="space-y-1">
            <h4 className="text-[11px] font-bold text-stone uppercase tracking-wide">All Assignments</h4>
            {(() => {
              const byVa = new Map<string, { name: string; cats: string[] }>();
              for (const a of vaCatAssignments) {
                const vaName = a.profiles?.full_name ?? "Unknown";
                const catName = a.task_categories?.category_name ?? "Unknown";
                if (!byVa.has(a.va_id)) byVa.set(a.va_id, { name: vaName, cats: [] });
                byVa.get(a.va_id)!.cats.push(catName);
              }
              return Array.from(byVa.entries()).map(([vaId, info]) => (
                <div key={vaId} className="flex items-center gap-2 text-[11px]">
                  <span className="font-semibold text-espresso w-32 truncate">{info.name}</span>
                  <div className="flex flex-wrap gap-1">
                    {info.cats.map((c, i) => (
                      <span key={i} className="bg-parchment text-stone px-1.5 py-0.5 rounded-full text-[10px]">{c}</span>
                    ))}
                  </div>
                </div>
              ));
            })()}
          </div>
        )}
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

/* ── Project Row Sub-Component ────────────────────────────── */

function ProjectRow({
  project,
  selected,
  isActiveProject,
  onToggleSelect,
  onClickProject,
  onEdit,
  onDelete,
  editing,
  editValue,
  onEditChange,
  onEditSave,
  onEditCancel,
  accounts,
  onMoveToAccount,
  taskCount,
  isExpanded,
}: {
  project: ProjectTag;
  selected: boolean;
  isActiveProject: boolean;
  onToggleSelect: () => void;
  onClickProject: () => void;
  onEdit: () => void;
  onDelete: () => void;
  editing: boolean;
  editValue: string;
  onEditChange: (v: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  accounts: Account[];
  onMoveToAccount: (accName: string | null) => void;
  taskCount: number;
  isExpanded?: boolean;
}) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  return (
    <div
      className={`px-2.5 py-1.5 flex items-center gap-1.5 text-xs transition-all cursor-pointer group ${
        isActiveProject
          ? "bg-terracotta-soft/40 ring-1 ring-terracotta/20"
          : "hover:bg-parchment/40"
      } ${selected ? "bg-sage-soft/30" : ""}`}
      onClick={() => {
        if (!editing) onClickProject();
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => { e.stopPropagation(); onToggleSelect(); }}
        onClick={(e) => e.stopPropagation()}
        className="h-3 w-3 rounded border-sand text-terracotta accent-terracotta cursor-pointer shrink-0"
      />
      {isExpanded !== undefined && <ChevronDown open={isExpanded} />}
      <ProjectIcon />
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`truncate ${isActiveProject ? "font-semibold text-terracotta" : "text-espresso"}`}>
              {project.project_name}
            </span>
            <span className={`shrink-0 text-[10px] min-w-[18px] text-center px-1 py-0.5 rounded-full font-semibold leading-none ${taskCount > 0 ? "bg-sage-soft text-sage" : "bg-gray-100 text-gray-400"}`}>
              {taskCount}
            </span>
          </div>
        )}
      </div>
      {!editing && (
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          {/* Move to different account */}
          <div className="relative">
            <button
              onClick={() => setShowMoveMenu(!showMoveMenu)}
              className="p-0.5 rounded text-stone hover:text-espresso cursor-pointer"
              title="Move to account"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
            </button>
            {showMoveMenu && (
              <div className="absolute right-0 top-6 z-20 bg-white border border-sand rounded-lg shadow-lg py-1 min-w-[140px]">
                <button
                  onClick={() => { onMoveToAccount(null); setShowMoveMenu(false); }}
                  className={`w-full text-left px-2.5 py-1 text-[11px] hover:bg-parchment cursor-pointer ${project.account === null ? "font-bold text-terracotta" : "text-espresso"}`}
                >
                  Unassigned
                </button>
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => { onMoveToAccount(a.name); setShowMoveMenu(false); }}
                    className={`w-full text-left px-2.5 py-1 text-[11px] hover:bg-parchment cursor-pointer ${project.account === a.name ? "font-bold text-terracotta" : "text-espresso"}`}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={onEdit} className="p-0.5 rounded text-stone hover:text-espresso cursor-pointer" title="Rename"><EditIcon /></button>
          <button onClick={onDelete} className="p-0.5 rounded text-stone hover:text-red-600 cursor-pointer" title="Delete"><TrashIcon /></button>
        </div>
      )}
    </div>
  );
}
