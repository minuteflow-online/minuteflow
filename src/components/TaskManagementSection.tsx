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

interface Submission {
  id: number;
  va_task_assignment_id: number;
  user_id: string;
  message_type: MessageType;
  content: string;
  created_at: string;
  profiles: { id: string; full_name: string; username: string; role: string } | null;
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

/* ── Linkify helper ────────────────────────────────────── */

function linkify(text: string) {
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) =>
    urlRegex.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 underline hover:text-blue-800 break-all"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

/* ── Message type styling ──────────────────────────────── */

const MSG_STYLES: Record<MessageType, { label: string; bg: string; border: string }> = {
  instruction: { label: "Instructions", bg: "bg-indigo-50", border: "border-l-indigo-400" },
  submission: { label: "Submission", bg: "bg-blue-50", border: "border-l-blue-400" },
  revision: { label: "Revision Requested", bg: "bg-amber-50", border: "border-l-amber-400" },
  approval: { label: "Approved", bg: "bg-emerald-50", border: "border-l-emerald-400" },
  comment: { label: "Comment", bg: "bg-gray-50", border: "border-l-gray-400" },
};

/* ── Main Component ────────────────────────────────────── */

export default function TaskManagementSection() {
  const [assignments, setAssignments] = useState<VaTaskAssignmentRow[]>([]);
  const [submissions, setSubmissions] = useState<Record<number, Submission[]>>({});
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
      // Filter to only fixed and project-based assignments
      const filtered = (data.assignments ?? []).filter(
        (a: VaTaskAssignmentRow) => a.billing_type === "fixed" || a.billing_type === "hourly"
      );
      setAssignments(filtered);
    } catch {
      console.error("Failed to fetch assignments");
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Fetch submissions for a specific assignment ── */
  const fetchSubmissions = useCallback(async (assignmentId: number) => {
    try {
      const res = await fetch(`/api/task-submissions?va_task_assignment_id=${assignmentId}`);
      const data = await res.json();
      setSubmissions((prev) => ({ ...prev, [assignmentId]: data.submissions ?? [] }));
    } catch {
      console.error("Failed to fetch submissions");
    }
  }, []);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  /* ── When expanding a row, fetch its submissions ── */
  const handleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
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
      // Also post as instruction message if text is non-empty and different from existing
      if (text.trim() && text !== assignment.instructions) {
        await fetch("/api/task-submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            va_task_assignment_id: assignment.id,
            message_type: "instruction",
            content: text,
          }),
        });
        fetchSubmissions(assignment.id);
      }
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

  /* ── Post a message (revision, approval, comment) ── */
  const handlePostMessage = async (assignmentId: number) => {
    if (!newMessage.trim()) return;
    try {
      await fetch("/api/task-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          va_task_assignment_id: assignmentId,
          message_type: messageType,
          content: newMessage.trim(),
        }),
      });
      setNewMessage("");
      fetchSubmissions(assignmentId);
      fetchAssignments(); // status may have changed
    } catch {
      console.error("Failed to post message");
    }
  };

  /* ── Quick approve ── */
  const handleApprove = async (assignmentId: number) => {
    try {
      await fetch("/api/task-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          va_task_assignment_id: assignmentId,
          message_type: "approval",
          content: "Approved! Great work.",
        }),
      });
      fetchSubmissions(assignmentId);
      fetchAssignments();
    } catch {
      console.error("Failed to approve");
    }
  };

  /* ── Quick request revision ── */
  const handleRequestRevision = async (assignmentId: number) => {
    if (!newMessage.trim()) {
      setMessageType("revision");
      return; // force them to write feedback
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
      fetchSubmissions(assignmentId);
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
          const msgs = submissions[a.id] ?? [];

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
                  {/* Instructions */}
                  <div>
                    <label className="text-[10px] font-bold text-stone uppercase tracking-wide block mb-1">
                      Instructions / Directions
                    </label>
                    <textarea
                      value={editingInstructions[a.id] ?? a.instructions ?? ""}
                      onChange={(e) =>
                        setEditingInstructions((prev) => ({ ...prev, [a.id]: e.target.value }))
                      }
                      placeholder="Write task instructions, paste links, describe deliverables..."
                      className="w-full rounded-lg border border-sand px-3 py-2 text-xs text-espresso outline-none resize-y min-h-[60px] focus:border-sage"
                    />
                    {editingInstructions[a.id] !== undefined &&
                      editingInstructions[a.id] !== (a.instructions ?? "") && (
                        <button
                          onClick={() => handleSaveInstructions(a)}
                          disabled={savingInstructions === a.id}
                          className="mt-1 px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-[#5a7a5e] disabled:opacity-50 cursor-pointer"
                        >
                          {savingInstructions === a.id ? "Saving..." : "Save Instructions"}
                        </button>
                      )}
                  </div>

                  {/* Communication Thread */}
                  <div>
                    <label className="text-[10px] font-bold text-stone uppercase tracking-wide block mb-1">
                      Communication Thread
                    </label>
                    {msgs.length === 0 ? (
                      <p className="text-stone text-[11px] italic">No messages yet.</p>
                    ) : (
                      <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {msgs.map((m) => {
                          const style = MSG_STYLES[m.message_type];
                          return (
                            <div
                              key={m.id}
                              className={`${style.bg} border-l-3 ${style.border} rounded-r-lg px-3 py-2`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] font-bold text-stone uppercase">
                                  {style.label}
                                </span>
                                <span className="text-[10px] text-stone">
                                  by {m.profiles?.full_name ?? "Unknown"}
                                </span>
                                <span className="text-[10px] text-stone/50">
                                  {new Date(m.created_at).toLocaleString()}
                                </span>
                              </div>
                              <div className="text-xs text-espresso whitespace-pre-wrap">
                                {linkify(m.content)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons (when submitted) */}
                  {a.status === "submitted" && (
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
                  )}

                  {/* New Message */}
                  <div className="flex gap-2">
                    <select
                      value={messageType}
                      onChange={(e) => setMessageType(e.target.value as MessageType)}
                      className="rounded-lg border border-sand px-2 py-1.5 text-[11px] text-espresso outline-none bg-white shrink-0"
                    >
                      <option value="instruction">Instruction</option>
                      <option value="revision">Revision Request</option>
                      <option value="comment">Comment</option>
                    </select>
                    <textarea
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      placeholder="Write a message, paste links..."
                      className="flex-1 rounded-lg border border-sand px-3 py-1.5 text-xs text-espresso outline-none resize-none min-h-[36px] focus:border-sage"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handlePostMessage(a.id);
                        }
                      }}
                    />
                    <button
                      onClick={() => handlePostMessage(a.id)}
                      disabled={!newMessage.trim()}
                      className="px-3 py-1.5 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-[#5a7a5e] disabled:opacity-50 cursor-pointer shrink-0"
                    >
                      Send
                    </button>
                  </div>
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
