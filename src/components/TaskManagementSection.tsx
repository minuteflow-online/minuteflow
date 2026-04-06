"use client";

import { useState, useEffect, useCallback } from "react";

/* ── Types ─────────────────────────────────────────────── */

type BillingType = "hourly" | "fixed";
type AssignmentStatus = "not_started" | "submitted" | "revision_needed" | "approved";
type MessageType = "instruction" | "submission" | "revision" | "approval" | "comment";

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

/* ── Status helpers ────────────────────────────────────── */

const STATUS_LABELS: Record<AssignmentStatus, string> = {
  not_started: "Not Started",
  submitted: "Submitted",
  revision_needed: "Revision Needed",
  approved: "Approved",
};

const STATUS_COLORS: Record<AssignmentStatus, string> = {
  not_started: "bg-stone/10 text-stone",
  submitted: "bg-blue-100 text-blue-700",
  revision_needed: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
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

  /* ── Fetch assignments (fixed + project-based only) ── */
  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/va-task-assignments?assignment_type=include");
      const data = await res.json();
      // Filter: only show if VA position is "Project Based VA" OR billing_type is "fixed"
      const filtered = (data.assignments ?? []).filter(
        (a: VaTaskAssignmentRow) =>
          a.billing_type === "fixed" ||
          a.profiles?.position?.toLowerCase().includes("project based")
      );
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

  /* ── Expand/collapse row ── */
  const handleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
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
      await fetch("/api/task-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          va_task_assignment_id: assignmentId,
          message_type: "approval",
          content: "Approved",
        }),
      });
      fetchAssignments();
    } catch {
      console.error("Failed to approve");
    }
  };

  /* ── Request revision ── */
  const handleRequestRevision = async (assignmentId: number) => {
    if (!newMessage.trim()) {
      setMessageType("revision");
      return; // show feedback input
    }
    try {
      await fetch("/api/task-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          va_task_assignment_id: assignmentId,
          message_type: "revision",
          content: newMessage.trim(),
        }),
      });
      setNewMessage("");
      setMessageType("instruction");
      fetchAssignments();
    } catch {
      console.error("Failed to request revision");
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

  if (assignments.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide mb-2">
          Fixed & Project-Based Task Management
        </h3>
        <p className="text-stone text-xs">
          No fixed or project-based task assignments yet. Assign tasks to VAs in the columns above, then manage submissions here.
        </p>
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
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as AssignmentStatus | "all")}
            className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
          >
            <option value="all">All Statuses</option>
            <option value="not_started">Not Started</option>
            <option value="submitted">Submitted</option>
            <option value="revision_needed">Revision Needed</option>
            <option value="approved">Approved</option>
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

      {/* ── Assignment Table ── */}
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

                  {/* Action Buttons — always visible when not approved */}
                  {a.status !== "approved" ? (
                    <div className="flex items-center gap-2">
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
                  ) : (
                    <div className="text-emerald-600 text-[11px] font-semibold">
                      ✓ Approved
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
    </div>
  );
}
