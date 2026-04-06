"use client";

import { useState, useEffect, useCallback } from "react";

/* ── Types ─────────────────────────────────────────────── */

type AssignmentStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "reviewing"
  | "revision_needed"
  | "approved"
  | "completed";

interface Assignment {
  id: number;
  va_id: string;
  billing_type: string;
  rate: number | null;
  status: AssignmentStatus;
  instructions: string | null;
  profiles: { id: string; full_name: string; username: string; position: string | null } | null;
  project_task_assignments: {
    id: number;
    task_library: { id: number; task_name: string } | null;
    project_tags: { id: number; account: string; project_name: string } | null;
  } | null;
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

/* ── Main Component ────────────────────────────────────── */

export default function VaAssignmentsColumn({ userId }: { userId: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [submissionLinks, setSubmissionLinks] = useState<Record<number, string>>({});
  const [submissionComments, setSubmissionComments] = useState<Record<number, string>>({});

  /* ── Fetch assignments ── */
  const fetchAssignments = useCallback(async () => {
    try {
      const res = await fetch(`/api/va-task-assignments?va_id=${userId}&assignment_type=include`);
      const data = await res.json();
      setAssignments(data.assignments ?? []);
    } catch {
      console.error("Failed to fetch assignments");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) fetchAssignments();
  }, [userId, fetchAssignments]);

  /* ── Submit work ── */
  const handleSubmit = async (assignmentId: number) => {
    setSubmitting(assignmentId);
    const link = submissionLinks[assignmentId] || "";
    const comment = submissionComments[assignmentId] || "";

    // Build content with link and comment
    const parts: string[] = [];
    if (link.trim()) parts.push(`Link: ${link.trim()}`);
    if (comment.trim()) parts.push(comment.trim());
    const content = parts.length > 0 ? parts.join("\n") : "Submitted for review";

    try {
      await fetch("/api/task-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          va_task_assignment_id: assignmentId,
          message_type: "submission",
          content,
          submission_link: link.trim() || null,
          submission_comment: comment.trim() || null,
        }),
      });
      // Clear form fields
      setSubmissionLinks((prev) => ({ ...prev, [assignmentId]: "" }));
      setSubmissionComments((prev) => ({ ...prev, [assignmentId]: "" }));
      fetchAssignments();
    } catch {
      console.error("Failed to submit");
    } finally {
      setSubmitting(null);
    }
  };

  /* ── Expand/collapse ── */
  const handleExpand = (id: number) => {
    setExpandedId(expandedId === id ? null : id);
  };

  // Count revision-needed assignments for header indicator
  const revisionCount = assignments.filter((a) => a.status === "revision_needed").length;

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
        {revisionCount > 0 && (
          <span className="ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700 animate-pulse">
            {revisionCount} revision{revisionCount > 1 ? "s" : ""} needed
          </span>
        )}
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

            return (
              <div
                key={a.id}
                className={`rounded-lg border overflow-hidden ${
                  a.status === "revision_needed" ? "border-amber-300" : "border-sand"
                }`}
              >
                {/* Assignment row */}
                <div
                  onClick={() => handleExpand(a.id)}
                  className={`px-2.5 py-2 cursor-pointer transition-colors ${
                    a.status === "revision_needed"
                      ? "bg-amber-50/50"
                      : isExpanded
                      ? "bg-parchment/30"
                      : "hover:bg-parchment/20"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-medium text-espresso truncate">{taskName}</span>
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${STATUS_COLORS[a.status]}`}
                    >
                      {STATUS_LABELS[a.status]}
                    </span>
                  </div>
                  <div className="text-[10px] text-stone mt-0.5 truncate">
                    {account}
                    {project ? ` / ${project}` : ""}
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

                    {/* Status feedback */}
                    {a.status === "completed" && (
                      <div className="bg-green-50 border-l-3 border-l-green-500 rounded-r-lg px-2.5 py-2">
                        <div className="text-[11px] font-semibold text-green-800">Completed</div>
                      </div>
                    )}

                    {a.status === "approved" && (
                      <div className="bg-emerald-50 border-l-3 border-l-emerald-400 rounded-r-lg px-2.5 py-2">
                        <div className="text-[11px] font-semibold text-emerald-700">Approved</div>
                      </div>
                    )}

                    {a.status === "reviewing" && (
                      <div className="bg-violet-50 border-l-3 border-l-violet-400 rounded-r-lg px-2.5 py-2">
                        <div className="text-[11px] font-semibold text-violet-700">
                          Under review by admin
                        </div>
                      </div>
                    )}

                    {a.status === "revision_needed" && (
                      <div className="bg-amber-50 border-l-3 border-l-amber-400 rounded-r-lg px-2.5 py-2">
                        <div className="text-[11px] font-semibold text-amber-700">
                          Revision requested — please check instructions and resubmit
                        </div>
                      </div>
                    )}

                    {a.status === "submitted" && (
                      <div className="bg-blue-50 border-l-3 border-l-blue-400 rounded-r-lg px-2.5 py-2">
                        <div className="text-[11px] font-semibold text-blue-700">
                          Submitted — waiting for review
                        </div>
                      </div>
                    )}

                    {a.status === "in_progress" && (
                      <div className="bg-sky-50 border-l-3 border-l-sky-400 rounded-r-lg px-2.5 py-2">
                        <div className="text-[11px] font-semibold text-sky-700">
                          In progress — currently being worked on
                        </div>
                      </div>
                    )}

                    {a.status === "not_started" && !a.instructions && (
                      <div className="text-stone text-[11px] italic">
                        No instructions yet. Check back later.
                      </div>
                    )}

                    {/* Submission form — visible when not yet submitted, approved, or completed */}
                    {(a.status === "not_started" ||
                      a.status === "in_progress" ||
                      a.status === "revision_needed") && (
                      <div className="space-y-1.5">
                        {/* Link field */}
                        <input
                          type="url"
                          placeholder="Paste link (optional)"
                          value={submissionLinks[a.id] || ""}
                          onChange={(e) =>
                            setSubmissionLinks((prev) => ({ ...prev, [a.id]: e.target.value }))
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-sand text-xs text-espresso placeholder:text-stone/50 focus:outline-none focus:ring-1 focus:ring-sage/50"
                        />
                        {/* Comment field */}
                        <textarea
                          placeholder="Add a comment (optional)"
                          value={submissionComments[a.id] || ""}
                          onChange={(e) =>
                            setSubmissionComments((prev) => ({ ...prev, [a.id]: e.target.value }))
                          }
                          rows={2}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-sand text-xs text-espresso placeholder:text-stone/50 focus:outline-none focus:ring-1 focus:ring-sage/50 resize-none"
                        />
                        {/* Submit button */}
                        <button
                          onClick={() => handleSubmit(a.id)}
                          disabled={submitting === a.id}
                          className="w-full px-3 py-2 rounded-lg bg-sage text-white text-xs font-semibold hover:bg-[#5a7a5e] disabled:opacity-50 cursor-pointer transition-colors"
                        >
                          {submitting === a.id ? "Submitting..." : "Submit for Review"}
                        </button>
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
