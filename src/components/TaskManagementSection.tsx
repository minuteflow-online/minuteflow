"use client";

import { useState, useEffect, useCallback } from "react";

/* ── Types ─────────────────────────────────────────────── */

type BillingType = "hourly" | "fixed";
type AssignmentStatus = "not_started" | "in_progress" | "submitted" | "reviewing" | "revision_needed" | "approved" | "completed";
type MessageType = "instruction" | "submission" | "revision" | "approval" | "comment";

interface Submission {
  id: number;
  message_type: string;
  content: string;
  submission_link: string | null;
  submission_comment: string | null;
  created_at: string;
  profiles: { full_name: string } | null;
}

interface VaTaskAssignmentRow {
  id: number;
  va_id: string;
  billing_type: BillingType;
  rate: number | null;
  status: AssignmentStatus;
  instructions: string | null;
  assigned_at: string;
  profiles: { id: string; full_name: string; username: string; position: string | null } | null;
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

interface TaskLibraryItem {
  id: number;
  task_name: string;
  billing_type: string;
  default_rate: number | null;
}

interface ProjectTag {
  id: number;
  account: string;
  project_name: string;
}

interface VAProfile {
  id: string;
  full_name: string;
  username: string;
}

/* ── Status helpers ────────────────────────────────────── */

const STATUS_LABELS: Record<AssignmentStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  submitted: "Submitted",
  reviewing: "Reviewing",
  revision_needed: "Revision Needed",
  approved: "Approved",
  completed: "Completed",
};

const STATUS_COLORS: Record<AssignmentStatus, string> = {
  not_started: "bg-stone/10 text-stone",
  in_progress: "bg-sky-100 text-sky-700",
  submitted: "bg-blue-100 text-blue-700",
  reviewing: "bg-violet-100 text-violet-700",
  revision_needed: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  completed: "bg-green-100 text-green-800",
};

/* ── Main Component ────────────────────────────────────── */

export default function TaskManagementSection() {
  const [assignments, setAssignments] = useState<VaTaskAssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [messageType, setMessageType] = useState<MessageType>("instruction");
  const [savingInstructions, setSavingInstructions] = useState<number | null>(null);
  const [editingInstructions, setEditingInstructions] = useState<Record<number, string>>({});
  const [filterStatus, setFilterStatus] = useState<AssignmentStatus | "all">("all");
  const [filterVA, setFilterVA] = useState<string>("all");
  const [submissions, setSubmissions] = useState<Record<number, Submission[]>>({});

  /* ── Add Task Form state ── */
  const [showAddForm, setShowAddForm] = useState(false);
  const [taskLibrary, setTaskLibrary] = useState<TaskLibraryItem[]>([]);
  const [projects, setProjects] = useState<ProjectTag[]>([]);
  const [vaList, setVaList] = useState<VAProfile[]>([]);
  const [addTaskId, setAddTaskId] = useState<string>("");
  const [addProjectId, setAddProjectId] = useState<string>("");
  const [addBillingType, setAddBillingType] = useState<BillingType>("fixed");
  const [addRate, setAddRate] = useState<string>("");
  const [addVaId, setAddVaId] = useState<string>(""); // empty = up for grabs
  const [addInstructions, setAddInstructions] = useState<string>("");
  const [addingTask, setAddingTask] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);

  /* ── Fetch assignments (fixed + project-based only) ── */
  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/va-task-assignments?assignment_type=include");
      const data = await res.json();
      // Only show fixed-rate tasks OR hourly for project-based VAs
      const all = data.assignments ?? [];
      const filtered = all.filter((a: VaTaskAssignmentRow) => {
        if (a.billing_type === "fixed") return true;
        // Hourly tasks: only show if VA's position is "Project Based VA"
        if (a.billing_type === "hourly" && a.profiles?.position?.toLowerCase() === "project based va") return true;
        return false;
      });
      setAssignments(filtered);
    } catch {
      console.error("Failed to fetch assignments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  /* ── Fetch options for Add Task form ── */
  const fetchAddOptions = useCallback(async () => {
    setLoadingOptions(true);
    try {
      const [tasksRes, projectsRes, vasRes] = await Promise.all([
        fetch("/api/task-library"),
        fetch("/api/project-tags"),
        fetch("/api/profiles?role=va"),
      ]);
      const [tasksData, projectsData, vasData] = await Promise.all([
        tasksRes.json(),
        projectsRes.json(),
        vasRes.json(),
      ]);
      setTaskLibrary(tasksData.tasks ?? []);
      setProjects(projectsData.tags ?? projectsData.projects ?? []);
      setVaList(vasData.profiles ?? []);
    } catch {
      console.error("Failed to fetch add-task options");
    } finally {
      setLoadingOptions(false);
    }
  }, []);

  /* ── Handle Add Task ── */
  const handleAddTask = async () => {
    if (!addTaskId || !addProjectId) {
      alert("Please select a task and a project.");
      return;
    }
    setAddingTask(true);
    try {
      // Step 1: Ensure the task is assigned to the project (project_task_assignment)
      // First check if it already exists
      const ptaCheckRes = await fetch(`/api/project-task-assignments?project_tag_id=${addProjectId}`);
      const ptaCheckData = await ptaCheckRes.json();
      const existingPTAs = ptaCheckData.assignments ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let pta = existingPTAs.find((p: any) => p.task_library_id === parseInt(addTaskId));

      if (!pta) {
        // Create the project-task assignment
        const ptaRes = await fetch("/api/project-task-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_tag_id: parseInt(addProjectId),
            task_library_ids: [parseInt(addTaskId)],
          }),
        });
        const ptaData = await ptaRes.json();
        pta = ptaData.assignments?.[0];
      }

      if (!pta) {
        alert("Failed to create task-project link.");
        return;
      }

      // Update PTA billing type, rate, and instructions (for claimable tasks)
      await fetch("/api/project-task-assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: pta.id,
          billing_type: addBillingType,
          task_rate: addRate ? parseFloat(addRate) : null,
          instructions: addInstructions.trim() || null,
        }),
      });

      // Step 2: If a VA is selected, create the VA assignment
      if (addVaId) {
        const vaRes = await fetch("/api/va-task-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            va_id: addVaId,
            project_task_assignment_id: pta.id,
            billing_type: addBillingType,
            rate: addRate ? parseFloat(addRate) : null,
          }),
        });
        const vaData = await vaRes.json();
        const newAssignment = vaData.assignments?.[0];

        // If instructions were provided, save them to the VA assignment too
        if (addInstructions.trim() && newAssignment) {
          await fetch("/api/va-task-assignments", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: newAssignment.id,
              instructions: addInstructions.trim(),
            }),
          });
        }
      }
      // If no VA selected, task stays as a claimable PTA (up for grabs) with instructions on PTA

      // Reset form
      setShowAddForm(false);
      setAddTaskId("");
      setAddProjectId("");
      setAddBillingType("fixed");
      setAddRate("");
      setAddVaId("");
      setAddInstructions("");
      fetchAssignments();
    } catch (err) {
      console.error("Failed to add task:", err);
      alert("Failed to add task. Please try again.");
    } finally {
      setAddingTask(false);
    }
  };

  /* ── Fetch submissions for an assignment ── */
  const fetchSubmissions = useCallback(async (assignmentId: number) => {
    try {
      const res = await fetch(`/api/task-submissions?va_task_assignment_id=${assignmentId}`);
      const data = await res.json();
      setSubmissions((prev) => ({ ...prev, [assignmentId]: data.submissions ?? [] }));
    } catch {
      console.error("Failed to fetch submissions");
    }
  }, []);

  /* ── Expand/collapse row ── */
  const handleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      // Fetch submissions when expanding
      fetchSubmissions(id);
    }
    setNewMessage("");
    setMessageType("instruction");
  };

  /* ── Save instructions ── */
  const handleSaveInstructions = async (assignment: VaTaskAssignmentRow) => {
    const text = editingInstructions[assignment.id];
    if (text === undefined) return;
    setSavingInstructions(assignment.id);
    try {
      await fetch("/api/va-task-assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: assignment.id, instructions: text }),
      });
      fetchAssignments();
      setEditingInstructions((prev) => {
        const copy = { ...prev };
        delete copy[assignment.id];
        return copy;
      });
    } catch {
      console.error("Failed to save instructions");
    } finally {
      setSavingInstructions(null);
    }
  };

  /* ── Approve assignment ── */
  const handleApprove = async (assignmentId: number) => {
    try {
      const res = await fetch("/api/task-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          va_task_assignment_id: assignmentId,
          message_type: "approval",
          content: "Approved",
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(`Failed to approve: ${errData.error || res.statusText}`);
        return;
      }
      fetchAssignments();
      fetchSubmissions(assignmentId);
    } catch (err) {
      console.error("Failed to approve:", err);
      alert("Failed to approve — network error. Please try again.");
    }
  };

  /* ── Request revision ── */
  const handleRequestRevision = async (assignmentId: number) => {
    if (!newMessage.trim()) {
      setMessageType("revision");
      return; // show feedback input
    }
    try {
      const res = await fetch("/api/task-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          va_task_assignment_id: assignmentId,
          message_type: "revision",
          content: newMessage.trim(),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(`Failed to request revision: ${errData.error || res.statusText}`);
        return;
      }
      setNewMessage("");
      setMessageType("instruction");
      fetchAssignments();
      fetchSubmissions(assignmentId);
    } catch (err) {
      console.error("Failed to request revision:", err);
      alert("Failed to request revision — network error. Please try again.");
    }
  };

  /* ── Filter assignments ── */
  const filtered = assignments.filter((a) => {
    if (filterStatus !== "all" && a.status !== filterStatus) return false;
    if (filterVA !== "all" && a.va_id !== filterVA) return false;
    return true;
  });

  /* ── Get unique VAs for filter ── */
  const uniqueVAs = Array.from(
    new Map(assignments.map((a) => [a.va_id, a.profiles?.full_name ?? a.va_id])).entries()
  );

  if (loading) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4 text-center text-stone text-xs">
        Loading task management...
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      {/* ── Header & Filters ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">
          Fixed & Project-Based Task Management
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (!showAddForm) fetchAddOptions();
              setShowAddForm(!showAddForm);
            }}
            className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-[#5a7a5e] cursor-pointer transition-colors"
          >
            {showAddForm ? "Cancel" : "+ Add Task"}
          </button>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as AssignmentStatus | "all")}
            className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
          >
            <option value="all">All Statuses</option>
            <option value="not_started">Not Started</option>
            <option value="in_progress">In Progress</option>
            <option value="submitted">Submitted</option>
            <option value="reviewing">Reviewing</option>
            <option value="revision_needed">Revision Needed</option>
            <option value="approved">Approved</option>
            <option value="completed">Completed</option>
          </select>
          <select
            value={filterVA}
            onChange={(e) => setFilterVA(e.target.value)}
            className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
          >
            <option value="all">All VAs</option>
            {uniqueVAs.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Add Task Form ── */}
      {showAddForm && (
        <div className="border border-sage/30 rounded-lg bg-sage-soft/20 p-3 space-y-2">
          <div className="text-[10px] font-bold text-espresso uppercase tracking-wide">Add Fixed / Project-Based Task</div>
          {loadingOptions ? (
            <p className="text-stone text-[11px]">Loading options...</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {/* Task */}
                <div>
                  <label className="text-[10px] text-stone font-semibold block mb-0.5">Task</label>
                  <select
                    value={addTaskId}
                    onChange={(e) => setAddTaskId(e.target.value)}
                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                  >
                    <option value="">Select task...</option>
                    {taskLibrary.map((t) => (
                      <option key={t.id} value={t.id}>{t.task_name}</option>
                    ))}
                  </select>
                </div>
                {/* Project */}
                <div>
                  <label className="text-[10px] text-stone font-semibold block mb-0.5">Account / Project</label>
                  <select
                    value={addProjectId}
                    onChange={(e) => setAddProjectId(e.target.value)}
                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                  >
                    <option value="">Select project...</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.account} / {p.project_name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {/* Billing Type */}
                <div>
                  <label className="text-[10px] text-stone font-semibold block mb-0.5">Billing Type</label>
                  <select
                    value={addBillingType}
                    onChange={(e) => setAddBillingType(e.target.value as BillingType)}
                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                  >
                    <option value="fixed">Fixed Rate</option>
                    <option value="hourly">Hourly</option>
                  </select>
                </div>
                {/* Rate */}
                <div>
                  <label className="text-[10px] text-stone font-semibold block mb-0.5">Rate ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={addRate}
                    onChange={(e) => setAddRate(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                  />
                </div>
                {/* VA (optional) */}
                <div>
                  <label className="text-[10px] text-stone font-semibold block mb-0.5">
                    Assign to VA <span className="font-normal text-stone/70">(optional)</span>
                  </label>
                  <select
                    value={addVaId}
                    onChange={(e) => setAddVaId(e.target.value)}
                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                  >
                    <option value="">Up for grabs (claimable)</option>
                    {vaList.map((v) => (
                      <option key={v.id} value={v.id}>{v.full_name}</option>
                    ))}
                  </select>
                </div>
              </div>
              {/* Instructions */}
              <div>
                <label className="text-[10px] text-stone font-semibold block mb-0.5">
                  Instructions <span className="font-normal text-stone/70">(optional)</span>
                </label>
                <textarea
                  value={addInstructions}
                  onChange={(e) => setAddInstructions(e.target.value)}
                  placeholder="Paste a link or add instructions..."
                  rows={2}
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white resize-none"
                />
              </div>
              {/* Info text */}
              {!addVaId && (
                <p className="text-[10px] text-terracotta italic">
                  No VA selected — this task will appear as &quot;Available&quot; for any VA to claim on their dashboard.
                </p>
              )}
              {/* Submit */}
              <button
                onClick={handleAddTask}
                disabled={addingTask || !addTaskId || !addProjectId}
                className="px-4 py-1.5 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-[#5a7a5e] disabled:opacity-50 cursor-pointer transition-colors"
              >
                {addingTask ? "Adding..." : "Add to Task List"}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Assignment Table ── */}
      {assignments.length === 0 ? (
        <p className="text-stone text-xs">
          No task assignments yet. Use the &quot;+ Add Task&quot; button above or assign tasks to VAs in the columns above.
        </p>
      ) : (
        <div className="border border-sand rounded-lg overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_1fr_1fr_80px_80px_100px] gap-2 px-3 py-2 bg-parchment/50 border-b border-sand text-[10px] font-bold text-stone uppercase tracking-wide">
            <span>Task</span>
            <span>Account / Project</span>
            <span>VA</span>
            <span>Type</span>
            <span>Rate</span>
            <span>Status</span>
          </div>

          {/* Rows */}
          {filtered.map((a) => {
            const pta = a.project_task_assignments;
            const taskName = pta?.task_library?.task_name ?? "Unknown Task";
            const account = pta?.project_tags?.account ?? "—";
            const project = pta?.project_tags?.project_name ?? "—";
            const vaName = a.profiles?.full_name ?? "Unknown";
            const isExpanded = expandedId === a.id;

            return (
              <div key={a.id} className="border-b border-sand last:border-b-0">
                {/* Row */}
                <div
                  onClick={() => handleExpand(a.id)}
                  className={`grid grid-cols-[1fr_1fr_1fr_80px_80px_100px] gap-2 px-3 py-2.5 text-xs cursor-pointer transition-colors ${
                    isExpanded ? "bg-parchment/30" : "hover:bg-parchment/20"
                  }`}
                >
                  <span className="font-medium text-espresso truncate">{taskName}</span>
                  <span className="text-stone truncate">{account} / {project}</span>
                  <span className="text-espresso truncate">{vaName}</span>
                  <span className="text-stone capitalize">{a.billing_type}</span>
                  <span className="text-espresso font-medium">
                    {a.rate != null ? `$${Number(a.rate).toFixed(2)}` : "—"}
                  </span>
                  <span>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[a.status]}`}>
                      {STATUS_LABELS[a.status]}
                    </span>
                  </span>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="px-4 py-3 bg-parchment/10 border-t border-sand space-y-3">
                    {/* Instructions / Link */}
                    <div>
                      <label className="text-[10px] font-bold text-stone uppercase tracking-wide block mb-1">
                        Instructions / Link
                      </label>
                      <textarea
                        value={editingInstructions[a.id] ?? a.instructions ?? ""}
                        onChange={(e) =>
                          setEditingInstructions((prev) => ({ ...prev, [a.id]: e.target.value }))
                        }
                        placeholder="Paste a link for instructions and submissions..."
                        className="w-full rounded-lg border border-sand px-3 py-2 text-xs text-espresso outline-none resize-y min-h-[60px] focus:border-sage"
                      />
                      {editingInstructions[a.id] !== undefined &&
                        editingInstructions[a.id] !== (a.instructions ?? "") && (
                          <button
                            onClick={() => handleSaveInstructions(a)}
                            disabled={savingInstructions === a.id}
                            className="mt-1 px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-[#5a7a5e] disabled:opacity-50 cursor-pointer"
                          >
                            {savingInstructions === a.id ? "Saving..." : "Save"}
                          </button>
                        )}
                    </div>

                    {/* VA Submissions */}
                    {(submissions[a.id] ?? []).filter((s) => s.message_type === "submission").length > 0 && (
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-stone uppercase tracking-wide block">
                          VA Submissions
                        </label>
                        {(submissions[a.id] ?? [])
                          .filter((s) => s.message_type === "submission")
                          .map((s) => (
                            <div key={s.id} className="bg-blue-50 border-l-3 border-l-blue-400 rounded-r-lg px-2.5 py-2 space-y-0.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-semibold text-blue-700">
                                  {s.profiles?.full_name ?? "VA"}
                                </span>
                                <span className="text-[9px] text-stone">
                                  {new Date(s.created_at).toLocaleString()}
                                </span>
                              </div>
                              {s.submission_link && (
                                <div className="text-xs">
                                  <span className="text-stone font-medium">Link: </span>
                                  <a
                                    href={s.submission_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 underline hover:text-blue-800 break-all"
                                  >
                                    {s.submission_link}
                                  </a>
                                </div>
                              )}
                              {s.submission_comment && (
                                <div className="text-xs text-espresso whitespace-pre-wrap">
                                  {s.submission_comment}
                                </div>
                              )}
                              {!s.submission_link && !s.submission_comment && (
                                <div className="text-xs text-stone italic">{s.content}</div>
                              )}
                            </div>
                          ))}
                      </div>
                    )}

                    {/* Action Buttons */}
                    {a.status === "completed" ? (
                      <div className="text-green-700 text-[11px] font-semibold">Completed</div>
                    ) : a.status === "approved" ? (
                      <div className="text-emerald-600 text-[11px] font-semibold">Approved</div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => handleApprove(a.id)}
                          className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 cursor-pointer transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRequestRevision(a.id)}
                          className="px-4 py-1.5 rounded-lg bg-amber-500 text-white text-[11px] font-semibold hover:bg-amber-600 cursor-pointer transition-colors"
                        >
                          Request Revision
                        </button>
                      </div>
                    )}

                    {/* Revision feedback input — shown when Request Revision is clicked */}
                    {messageType === "revision" && (
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-stone uppercase tracking-wide block">
                          Revision Feedback
                        </label>
                        <textarea
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          placeholder="Describe what needs to be revised..."
                          className="w-full rounded-lg border border-amber-300 px-3 py-1.5 text-xs text-espresso outline-none resize-none min-h-[50px] focus:border-amber-500"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              if (newMessage.trim()) handleRequestRevision(a.id);
                            }}
                            disabled={!newMessage.trim()}
                            className="px-3 py-1 rounded-lg bg-amber-500 text-white text-[11px] font-semibold hover:bg-amber-600 disabled:opacity-50 cursor-pointer"
                          >
                            Send Revision Request
                          </button>
                          <button
                            onClick={() => { setMessageType("instruction"); setNewMessage(""); }}
                            className="px-3 py-1 rounded-lg border border-sand text-stone text-[11px] hover:bg-parchment/30 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="px-3 py-4 text-center text-stone text-xs">
              No assignments match the current filters.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
