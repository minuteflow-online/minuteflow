"use client";

import { useState, useEffect, useCallback } from "react";

/* ── Types ─────────────────────────────────────────────── */

type AssignmentStatus = "not_started" | "submitted" | "revision_needed" | "approved";

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

/* ── Main Component ────────────────────────────────────── */

export default function VaAssignmentsColumn({ userId }: { userId: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  /* ── Fetch assignments ── */
  const fetchAssignments = useCallback(async () => {
    try {
      const res = await fetch(`/api/va-task-assignments?va_id=${userId}&assignment_type=include`);
      const data = await res.json();
      // Only show if billing_type is "fixed" or VA position is project-based
      const filtered = (data.assignments ?? []).filter(
        (a: Assignment) =>
          a.billing_type === "fixed" ||
          a.profiles?.position?.toLowerCase().includes("project based")
      );
      setAssignments(filtered);
    } catch {
      console.error("Failed to fetch assignments");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) fetchAssignments();
  }, [userId, fetchAssignments]);

  /* ── Expand/collapse ── */
  const handleExpand = (id: number) => {
    setExpandedId(expandedId === id ? null : id);
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

                    {/* Status feedback */}
                    {a.status === "approved" && (
                      <div className="bg-emerald-50 border-l-3 border-l-emerald-400 rounded-r-lg px-2.5 py-2">
                        <div className="text-[11px] font-semibold text-emerald-700">
                          ✓ Approved
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

                    {a.status === "not_started" && !a.instructions && (
                      <div className="text-stone text-[11px] italic">
                        No instructions yet. Check back later.
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
