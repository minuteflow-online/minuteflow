"use client";

import { useState, useEffect, useCallback } from "react";

/* ── Types ─────────────────────────────────────────────── */

type AssignmentStatus = "not_started" | "submitted" | "revision_needed" | "approved";
type MessageType = "instruction" | "submission" | "revision" | "approval" | "comment";

interface Assignment {
  id: number;
  va_id: string;
  billing_type: string;
  rate: number | null;
  status: AssignmentStatus;
  instructions: string | null;
  project_task_assignments: {
    id: number;
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
  revision_needed: "Needs Revision",
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
  submission: { label: "Your Submission", bg: "bg-blue-50", border: "border-l-blue-400" },
  revision: { label: "Revision Requested", bg: "bg-amber-50", border: "border-l-amber-400" },
  approval: { label: "Approved", bg: "bg-emerald-50", border: "border-l-emerald-400" },
  comment: { label: "Comment", bg: "bg-gray-50", border: "border-l-gray-400" },
};

/* ── Main Component ────────────────────────────────────── */

export default function VaAssignmentsColumn({ userId }: { userId: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Record<number, Submission[]>>({});
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [submitText, setSubmitText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /* ── Fetch assignments ── */
  const fetchAssignments = useCallback(async () => {
    try {
      const res = await fetch(`/api/va-task-assignments?va_id=${userId}&assignment_type=include`);
      const data = await res.json();
      // Only show fixed and project-based (not exclude-type)
      setAssignments(data.assignments ?? []);
    } catch {
      console.error("Failed to fetch assignments");
    } finally {
      setLoading(false);
    }
  }, [userId]);

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

  useEffect(() => {
    if (userId) fetchAssignments();
  }, [userId, fetchAssignments]);

  /* ── Expand/collapse ── */
  const handleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      fetchSubmissions(id);
    }
    setSubmitText("");
  };

  /* ── Submit work ── */
  const handleSubmit = async (assignmentId: number) => {
    if (!submitText.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/task-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          va_task_assignment_id: assignmentId,
          message_type: "submission",
          content: submitText.trim(),
        }),
      });
      setSubmitText("");
      fetchSubmissions(assignmentId);
      fetchAssignments();
    } catch {
      console.error("Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  // Don't render if no assignments
  if (!loading && assignments.length === 0) return null;

  return (
    <div className="rounded-xl border border-sand bg-white p-3 space-y-2 max-h-[75vh] overflow-y-auto">
      <h3 className="text-xs font-bold text-espresso uppercase tracking-wide flex items-center gap-1.5 sticky top-0 bg-white pb-1 z-10">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="M9 14l2 2 4-4" />
        </svg>
        My Assignments
        <span className="text-stone font-normal normal-case">({assignments.length})</span>
      </h3>

      {loading ? (
        <p className="text-stone text-[11px] text-center py-3">Loading...</p>
      ) : (
        <div className="space-y-1.5">
          {assignments.map((a) => {
            const taskName = a.project_task_assignments?.task_library?.task_name ?? "Unknown Task";
            const account = a.project_task_assignments?.project_tags?.account ?? "";
            const project = a.project_task_assignments?.project_tags?.project_name ?? "";
            const isExpanded = expandedId === a.id;
            const msgs = submissions[a.id] ?? [];

            return (
              <div key={a.id} className="rounded-lg border border-sand overflow-hidden">
                {/* Assignment row */}
                <div
                  onClick={() => handleExpand(a.id)}
                  className={`px-2.5 py-2 cursor-pointer transition-colors ${
                    isExpanded ? "bg-parchment/30" : "hover:bg-parchment/20"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-medium text-espresso truncate">{taskName}</span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${STATUS_COLORS[a.status]}`}>
                      {STATUS_LABELS[a.status]}
                    </span>
                  </div>
                  <div className="text-[10px] text-stone mt-0.5 truncate">
                    {account}{project ? ` / ${project}` : ""}
                    {a.rate != null && (
                      <span className="ml-1 text-sage font-medium">${Number(a.rate).toFixed(2)}</span>
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-2.5 py-2.5 border-t border-sand bg-parchment/10 space-y-2">
                    {/* Instructions from admin */}
                    {a.instructions && (
                      <div className="bg-indigo-50 border-l-3 border-l-indigo-400 rounded-r-lg px-2.5 py-2">
                        <div className="text-[10px] font-bold text-stone uppercase mb-1">Instructions</div>
                        <div className="text-xs text-espresso whitespace-pre-wrap">
                          {linkify(a.instructions)}
                        </div>
                      </div>
                    )}

                    {/* Communication thread */}
                    {msgs.length > 0 && (
                      <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                        {msgs.map((m) => {
                          const style = MSG_STYLES[m.message_type];
                          return (
                            <div
                              key={m.id}
                              className={`${style.bg} border-l-3 ${style.border} rounded-r-lg px-2.5 py-1.5`}
                            >
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-[9px] font-bold text-stone uppercase">{style.label}</span>
                                <span className="text-[9px] text-stone/50">
                                  {new Date(m.created_at).toLocaleString()}
                                </span>
                              </div>
                              <div className="text-[11px] text-espresso whitespace-pre-wrap">
                                {linkify(m.content)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Submit work (not shown if already approved) */}
                    {a.status !== "approved" && (
                      <div className="space-y-1.5">
                        <textarea
                          value={submitText}
                          onChange={(e) => setSubmitText(e.target.value)}
                          placeholder="Paste links or describe where to find your work..."
                          className="w-full rounded-lg border border-sand px-2.5 py-1.5 text-[11px] text-espresso outline-none resize-y min-h-[50px] focus:border-sage"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleSubmit(a.id);
                            }
                          }}
                        />
                        <button
                          onClick={() => handleSubmit(a.id)}
                          disabled={!submitText.trim() || submitting}
                          className="w-full px-3 py-1.5 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-[#5a7a5e] disabled:opacity-50 cursor-pointer transition-colors"
                        >
                          {submitting ? "Submitting..." : "Submit Work"}
                        </button>
                      </div>
                    )}

                    {a.status === "approved" && (
                      <div className="text-center text-emerald-600 text-[11px] font-semibold py-1">
                        Approved
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
