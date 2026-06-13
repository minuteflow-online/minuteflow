"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// ─── Types ─────────────────────────────────────────────────────────────────────

type AssignmentStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "reviewing"
  | "revision_needed"
  | "approved"
  | "completed"
  | "paid";

interface MyAssignment {
  id: number;
  va_id: string;
  billing_type: string;
  rate: number | null;
  status: AssignmentStatus;
  instructions: string | null;
  quantity_claimed: number | null;
  project_task_assignments: {
    id: number;
    show_in_assignment?: boolean;
    custom_task_name?: string | null;
    task_library: { id: number; task_name: string } | null;
    project_tags: { id: number; account: string; project_name: string } | null;
  } | null;
}

interface ClaimableTask {
  id: number;
  task_library_id: number | null;
  custom_task_name?: string | null;
  billing_type: string | null;
  task_rate: number | null;
  instructions: string | null;
  task_library: { id: number; task_name: string; billing_type: string; default_rate: number | null } | null;
  project_tags: { id: number; account: string; project_name: string } | null;
}

interface Submission {
  id: number;
  message_type: string;
  content: string;
  submission_link: string | null;
  submission_comment: string | null;
  submission_screenshot_drive_id: string | null;
  submission_screenshot_url: string | null;
  created_at: string;
}

// ─── Status helpers ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<AssignmentStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  submitted: "Submitted",
  reviewing: "Reviewing",
  revision_needed: "Revision Needed",
  approved: "Approved",
  completed: "Completed",
  paid: "Paid",
};

const STATUS_COLORS: Record<AssignmentStatus, string> = {
  not_started: "bg-stone/10 text-stone",
  in_progress: "bg-sky-100 text-sky-700",
  submitted: "bg-blue-100 text-blue-700",
  reviewing: "bg-violet-100 text-violet-700",
  revision_needed: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  completed: "bg-green-100 text-green-800",
  paid: "bg-purple-100 text-purple-700",
};

// ─── Linkify ───────────────────────────────────────────────────────────────────

function linkify(text: string) {
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) =>
    urlRegex.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer"
        className="text-blue-600 underline hover:text-blue-800 break-all">{part}</a>
    ) : <span key={i}>{part}</span>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function TaskListPage() {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);

  // My assignments
  const [assignments, setAssignments] = useState<MyAssignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(true);

  // Claimable pool
  const [claimable, setClaimable] = useState<ClaimableTask[]>([]);
  const [claimableLoading, setClaimableLoading] = useState(true);

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null); // "a-{id}" or "c-{id}"

  // Submission form state
  const [submissionLinks, setSubmissionLinks] = useState<Record<number, string>>({});
  const [submissionComments, setSubmissionComments] = useState<Record<number, string>>({});
  const [submissionScreenshots, setSubmissionScreenshots] = useState<Record<number, File | null>>({});
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [uploadingScreenshot, setUploadingScreenshot] = useState<number | null>(null);

  // Submissions thread
  const [submissions, setSubmissions] = useState<Record<number, Submission[]>>({});
  const [submissionsLoading, setSubmissionsLoading] = useState<Record<number, boolean>>({});

  // Claim state
  const [claiming, setClaiming] = useState<number | null>(null);

  // Revision messages
  const [revisionMessages, setRevisionMessages] = useState<Record<number, string>>({});

  // Archive
  const [archiving, setArchiving] = useState<number | null>(null);

  // Filter
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus | "all">("all");

  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  // ── Auth ──
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch my assignments ──
  const fetchAssignments = useCallback(async () => {
    if (!userId) return;
    setAssignmentsLoading(true);
    try {
      const res = await fetch(`/api/va-task-assignments?va_id=${userId}&assignment_type=include&exclude_archived=true`);
      const data = await res.json();
      const all = data.assignments ?? [];
      const list = all.filter((a: MyAssignment) => {
        if (a.project_task_assignments?.show_in_assignment === false) return false;
        return true;
      });
      setAssignments(list);
      // Load revision messages for any revision_needed
      list.forEach((a: MyAssignment) => {
        if (a.status === "revision_needed") {
          fetchRevisionMessage(a.id);
        }
      });
    } catch {
      // silent
    } finally {
      setAssignmentsLoading(false);
    }
  }, [userId]);

  // ── Fetch claimable pool ──
  const fetchClaimable = useCallback(async () => {
    setClaimableLoading(true);
    try {
      const res = await fetch("/api/claimable-tasks");
      const data = await res.json();
      setClaimable(data.claimable ?? []);
    } catch {
      // silent
    } finally {
      setClaimableLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userId) {
      fetchAssignments();
      fetchClaimable();
    }
  }, [userId, fetchAssignments, fetchClaimable]);

  // ── Fetch revision message ──
  const fetchRevisionMessage = async (assignmentId: number) => {
    try {
      const res = await fetch(`/api/task-submissions?va_task_assignment_id=${assignmentId}`);
      const data = await res.json();
      const subs = data.submissions ?? [];
      const revisions = subs.filter((s: { message_type: string }) => s.message_type === "revision");
      if (revisions.length > 0) {
        const latest = revisions[revisions.length - 1];
        setRevisionMessages((prev) => ({ ...prev, [assignmentId]: latest.content }));
      }
    } catch {
      // silent
    }
  };

  // ── Fetch full submission thread ──
  const fetchSubmissions = async (assignmentId: number) => {
    setSubmissionsLoading((prev) => ({ ...prev, [assignmentId]: true }));
    try {
      const res = await fetch(`/api/task-submissions?va_task_assignment_id=${assignmentId}`);
      const data = await res.json();
      setSubmissions((prev) => ({ ...prev, [assignmentId]: data.submissions ?? [] }));
    } catch {
      // silent
    } finally {
      setSubmissionsLoading((prev) => ({ ...prev, [assignmentId]: false }));
    }
  };

  // ── Expand row ──
  const handleExpand = (key: string, assignmentId?: number) => {
    if (expandedId === key) {
      setExpandedId(null);
    } else {
      setExpandedId(key);
      if (assignmentId) fetchSubmissions(assignmentId);
    }
  };

  // ── Claim task ──
  const handleClaim = async (ptaId: number) => {
    setClaiming(ptaId);
    try {
      const res = await fetch("/api/claimable-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_task_assignment_id: ptaId, quantity_claimed: 1 }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to claim task");
        return;
      }
      setExpandedId(null);
      fetchClaimable();
      fetchAssignments();
    } catch {
      // silent
    } finally {
      setClaiming(null);
    }
  };

  // ── Submit work ──
  const handleSubmit = async (assignmentId: number) => {
    setSubmitting(assignmentId);
    const link = submissionLinks[assignmentId] || "";
    const comment = submissionComments[assignmentId] || "";
    const screenshotFile = submissionScreenshots[assignmentId] || null;

    let screenshotDriveId: string | null = null;
    let screenshotUrl: string | null = null;

    if (screenshotFile) {
      setUploadingScreenshot(assignmentId);
      try {
        const fd = new FormData();
        fd.append("file", screenshotFile);
        const upRes = await fetch("/api/upload-submission-screenshot", { method: "POST", body: fd });
        if (upRes.ok) {
          const upData = await upRes.json();
          screenshotDriveId = upData.drive_file_id || null;
          screenshotUrl = upData.url || null;
        }
      } catch {
        // non-fatal
      } finally {
        setUploadingScreenshot(null);
      }
    }

    const parts: string[] = [];
    if (link.trim()) parts.push(`Link: ${link.trim()}`);
    if (comment.trim()) parts.push(comment.trim());
    if (screenshotUrl) parts.push("Screenshot attached");
    const content = parts.length > 0 ? parts.join("\n") : "Submitted for review";

    try {
      const res = await fetch("/api/task-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          va_task_assignment_id: assignmentId,
          message_type: "submission",
          content,
          submission_link: link.trim() || null,
          submission_comment: comment.trim() || null,
          submission_screenshot_drive_id: screenshotDriveId,
          submission_screenshot_url: screenshotUrl,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(`Failed to submit: ${errData.error || res.statusText}`);
        return;
      }
      setSubmissionLinks((prev) => ({ ...prev, [assignmentId]: "" }));
      setSubmissionComments((prev) => ({ ...prev, [assignmentId]: "" }));
      setSubmissionScreenshots((prev) => ({ ...prev, [assignmentId]: null }));
      await fetchAssignments();
      await fetchSubmissions(assignmentId);
    } catch {
      alert("Failed to submit — network error. Please try again.");
    } finally {
      setSubmitting(null);
    }
  };

  // ── Archive ──
  const handleArchive = async (assignmentId: number) => {
    setArchiving(assignmentId);
    try {
      await fetch("/api/va-task-assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: assignmentId, archived_by_va: true }),
      });
      setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
      setExpandedId(null);
    } catch {
      // silent
    } finally {
      setArchiving(null);
    }
  };

  // ── Filtered assignments ──
  const filteredAssignments = statusFilter === "all"
    ? assignments
    : assignments.filter((a) => a.status === statusFilter);

  const revisionCount = assignments.filter((a) => a.status === "revision_needed").length;

  // ── Table row expand panel for an assignment ──
  const renderAssignmentDetail = (a: MyAssignment) => {
    const subs = submissions[a.id] ?? [];
    const subList = subs.filter((s) => s.message_type === "submission");
    const isSubmitting = submitting === a.id;
    const isUploading = uploadingScreenshot === a.id;
    const isLoading = submissionsLoading[a.id];
    const canSubmit = a.status === "not_started" || a.status === "in_progress" || a.status === "revision_needed";
    const canArchive = a.status === "completed" || a.status === "approved" || a.status === "paid";

    return (
      <tr key={`detail-a-${a.id}`}>
        <td colSpan={6} className="px-0 py-0">
          <div className="border-t border-sand bg-parchment/20 px-6 py-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left: instructions + status info */}
              <div className="space-y-3">
                {a.instructions && (
                  <div className="bg-indigo-50 border-l-4 border-l-indigo-400 rounded-r-lg px-3 py-3">
                    <div className="text-[10px] font-bold text-stone uppercase mb-1">Instructions</div>
                    <div className="text-sm text-espresso whitespace-pre-wrap">{linkify(a.instructions)}</div>
                  </div>
                )}

                {a.status === "revision_needed" && (
                  <div className="bg-amber-50 border-l-4 border-l-amber-400 rounded-r-lg px-3 py-2">
                    <div className="text-[10px] font-bold text-amber-800 uppercase mb-1">Revision Requested</div>
                    <div className="text-sm text-amber-900 whitespace-pre-wrap">
                      {revisionMessages[a.id] || "Please check instructions and resubmit."}
                    </div>
                  </div>
                )}

                {a.status === "approved" && (
                  <div className="bg-emerald-50 border-l-4 border-l-emerald-400 rounded-r-lg px-3 py-2">
                    <div className="text-sm font-semibold text-emerald-700">✓ Approved — payment will be processed</div>
                  </div>
                )}

                {a.status === "paid" && (
                  <div className="bg-purple-50 border-l-4 border-l-purple-400 rounded-r-lg px-3 py-2">
                    <div className="text-sm font-semibold text-purple-700">💜 Paid — payment has been processed</div>
                  </div>
                )}

                {a.status === "submitted" && (
                  <div className="bg-blue-50 border-l-4 border-l-blue-400 rounded-r-lg px-3 py-2">
                    <div className="text-sm font-semibold text-blue-700">Submitted — waiting for review</div>
                  </div>
                )}

                {a.status === "reviewing" && (
                  <div className="bg-violet-50 border-l-4 border-l-violet-400 rounded-r-lg px-3 py-2">
                    <div className="text-sm font-semibold text-violet-700">Under review by admin</div>
                  </div>
                )}

                {/* Previous submissions */}
                {isLoading ? (
                  <p className="text-xs text-stone">Loading submissions...</p>
                ) : subList.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-stone uppercase">Previous Submissions</div>
                    {subList.map((s) => (
                      <div key={s.id} className="bg-white border border-sand rounded-lg px-3 py-2 space-y-1.5">
                        <div className="text-[10px] text-stone">
                          {new Date(s.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}
                        </div>
                        {s.submission_link && (
                          <div className="text-xs">
                            <span className="font-medium text-stone">Link: </span>
                            <a href={s.submission_link} target="_blank" rel="noopener noreferrer"
                              className="text-blue-600 underline hover:text-blue-800 break-all">
                              {s.submission_link}
                            </a>
                          </div>
                        )}
                        {s.submission_comment && (
                          <div className="text-xs text-espresso whitespace-pre-wrap">{s.submission_comment}</div>
                        )}
                        {s.submission_screenshot_url && (
                          <div>
                            <a href={`https://drive.google.com/file/d/${s.submission_screenshot_drive_id}/view`}
                              target="_blank" rel="noopener noreferrer">
                              <img src={s.submission_screenshot_url} alt="Submission screenshot"
                                className="max-w-full max-h-32 rounded border border-sand object-contain hover:opacity-90 cursor-pointer" />
                            </a>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}

                {canArchive && (
                  <button
                    onClick={() => handleArchive(a.id)}
                    disabled={archiving === a.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone/10 text-stone text-xs font-semibold hover:bg-stone/20 cursor-pointer transition-colors disabled:opacity-50"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="21 8 21 21 3 21 3 8" />
                      <rect x="1" y="3" width="22" height="5" />
                      <line x1="10" y1="12" x2="14" y2="12" />
                    </svg>
                    Archive
                  </button>
                )}
              </div>

              {/* Right: submission form */}
              {canSubmit && (
                <div className="space-y-3">
                  <div className="text-[11px] font-bold text-stone uppercase tracking-wide">Submit Your Work</div>

                  {/* Start Logging button */}
                  <button
                    onClick={() => {
                      const taskName = a.project_task_assignments?.custom_task_name ?? a.project_task_assignments?.task_library?.task_name ?? "";
                      const acct = a.project_task_assignments?.project_tags?.account ?? "";
                      const proj = a.project_task_assignments?.project_tags?.project_name ?? "";
                      window.dispatchEvent(new CustomEvent("minuteflow-prefill", {
                        detail: { task_name: taskName, account: acct, project: proj },
                      }));
                      window.location.href = "/dashboard";
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 cursor-pointer transition-colors"
                  >
                    📋 Start Logging This Task
                  </button>

                  <input
                    type="url"
                    placeholder="Paste link to your work (optional)"
                    value={submissionLinks[a.id] || ""}
                    onChange={(e) => setSubmissionLinks((prev) => ({ ...prev, [a.id]: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-sand text-sm text-espresso placeholder:text-stone/50 focus:outline-none focus:ring-1 focus:ring-sage/50"
                  />

                  <textarea
                    placeholder="Add a comment (optional)"
                    value={submissionComments[a.id] || ""}
                    onChange={(e) => setSubmissionComments((prev) => ({ ...prev, [a.id]: e.target.value }))}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-sand text-sm text-espresso placeholder:text-stone/50 focus:outline-none focus:ring-1 focus:ring-sage/50 resize-none"
                  />

                  {/* Screenshot */}
                  <div>
                    <div className="text-[10px] font-semibold text-stone uppercase mb-1.5">Screenshot (optional)</div>
                    <label className={`inline-flex items-center gap-2 cursor-pointer rounded-lg border border-sand px-3 py-1.5 text-xs text-walnut hover:border-walnut transition-all ${isUploading ? "opacity-50 cursor-not-allowed" : ""}`}>
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      {submissionScreenshots[a.id] ? submissionScreenshots[a.id]!.name : "Choose screenshot"}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={isUploading}
                        ref={(el) => { fileInputRefs.current[a.id] = el; }}
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          setSubmissionScreenshots((prev) => ({ ...prev, [a.id]: f }));
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {submissionScreenshots[a.id] && (
                      <button type="button"
                        onClick={() => setSubmissionScreenshots((prev) => ({ ...prev, [a.id]: null }))}
                        className="ml-2 text-[10px] text-terracotta hover:underline cursor-pointer">
                        Remove
                      </button>
                    )}
                  </div>

                  <button
                    onClick={() => handleSubmit(a.id)}
                    disabled={isSubmitting || isUploading}
                    className="w-full px-4 py-2.5 rounded-lg bg-sage text-white text-sm font-semibold hover:bg-[#5a7a5e] disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    {isUploading ? "Uploading screenshot..." : isSubmitting ? "Submitting..." : "Submit for Review"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </td>
      </tr>
    );
  };

  // ── Table row expand panel for a claimable task ──
  const renderClaimableDetail = (t: ClaimableTask) => {
    const isClaiming = claiming === t.id;
    return (
      <tr key={`detail-c-${t.id}`}>
        <td colSpan={6} className="px-0 py-0">
          <div className="border-t border-sand bg-parchment/20 px-6 py-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                {t.instructions ? (
                  <div className="bg-indigo-50 border-l-4 border-l-indigo-400 rounded-r-lg px-3 py-3">
                    <div className="text-[10px] font-bold text-stone uppercase mb-1">Instructions</div>
                    <div className="text-sm text-espresso whitespace-pre-wrap">{linkify(t.instructions)}</div>
                  </div>
                ) : (
                  <p className="text-sm text-stone italic">No instructions provided. You can claim and get started.</p>
                )}
              </div>
              <div className="flex items-start">
                <button
                  onClick={() => handleClaim(t.id)}
                  disabled={isClaiming}
                  className="px-6 py-2.5 rounded-lg bg-terracotta text-white text-sm font-semibold hover:bg-[#c4573a] disabled:opacity-50 cursor-pointer transition-colors"
                >
                  {isClaiming ? "Claiming..." : "Claim This Task"}
                </button>
              </div>
            </div>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="min-h-screen bg-linen">
      <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">

        {/* ── Page header ── */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-espresso font-serif">Tasks</h1>
            <p className="text-sm text-stone mt-0.5">Your assigned tasks and available tasks to claim</p>
          </div>
          {revisionCount > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700 animate-pulse">
              {revisionCount} revision{revisionCount > 1 ? "s" : ""} needed
            </span>
          )}
        </div>

        {/* ── My Assignments section ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-base font-bold text-espresso flex items-center gap-2">
              <svg className="h-4 w-4 text-terracotta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <path d="M9 14l2 2 4-4" />
              </svg>
              My Assignments
              <span className="text-stone font-normal text-sm">({assignments.length})</span>
            </h2>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AssignmentStatus | "all")}
              className="py-2 px-3 border border-sand rounded-lg text-sm text-ink bg-white outline-none focus:border-terracotta cursor-pointer"
            >
              <option value="all">All Statuses</option>
              {(Object.keys(STATUS_LABELS) as AssignmentStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-sand bg-white overflow-hidden shadow-sm">
            {assignmentsLoading ? (
              <div className="p-8 text-center text-sm text-stone">Loading assignments...</div>
            ) : filteredAssignments.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-espresso">
                  {assignments.length === 0 ? "No assignments yet" : "No assignments match the filter"}
                </p>
                <p className="text-xs text-stone mt-1">
                  {assignments.length === 0 ? "Claim a task from the pool below to get started." : ""}
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-parchment border-b border-sand">
                    <th className="w-8"></th>
                    <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-4 py-3 text-left">Task</th>
                    <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-4 py-3 text-left">Account / Objective</th>
                    <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-4 py-3 text-left">Rate</th>
                    <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-4 py-3 text-left">Status</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssignments.map((a) => {
                    const taskName = a.project_task_assignments?.custom_task_name ?? a.project_task_assignments?.task_library?.task_name ?? "Unknown Task";
                    const account = a.project_task_assignments?.project_tags?.account ?? "";
                    const project = a.project_task_assignments?.project_tags?.project_name ?? "";
                    const rowKey = `a-${a.id}`;
                    const isExpanded = expandedId === rowKey;
                    const needsRevision = a.status === "revision_needed";

                    return (
                      <React.Fragment key={rowKey}>
                        <tr
                          onClick={() => handleExpand(rowKey, a.id)}
                          className={`border-b border-sand cursor-pointer group transition-colors ${
                            needsRevision ? "bg-amber-50/30 hover:bg-amber-50/50" : "hover:bg-parchment/30"
                          } ${isExpanded ? "bg-parchment/20" : ""}`}
                        >
                          {/* Expand chevron */}
                          <td className="px-3 py-3 w-8">
                            <svg
                              className={`h-4 w-4 text-stone transition-transform ${isExpanded ? "rotate-90" : ""}`}
                              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-medium text-espresso">{taskName}</span>
                            {needsRevision && (
                              <span className="ml-2 text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">Revision Needed</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-stone">
                            {account || "—"}
                            {project ? <span className="text-stone/60"> / {project}</span> : ""}
                          </td>
                          <td className="px-4 py-3">
                            {a.rate != null ? (
                              <span className="text-sm font-semibold text-sage">${Number(a.rate).toFixed(2)}</span>
                            ) : (
                              <span className="text-sm text-stone/40">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_COLORS[a.status]}`}>
                              {STATUS_LABELS[a.status]}
                            </span>
                          </td>
                          <td className="px-3 py-3 w-8">
                            <svg className="h-3.5 w-3.5 text-stone/40 group-hover:text-stone transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
                            </svg>
                          </td>
                        </tr>
                        {isExpanded && renderAssignmentDetail(a)}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Available to Claim section ── */}
        <div className="space-y-3">
          <h2 className="text-base font-bold text-espresso flex items-center gap-2">
            <svg className="h-4 w-4 text-terracotta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            Available to Claim
            <span className="text-stone font-normal text-sm">({claimable.length})</span>
          </h2>

          <div className="rounded-xl border border-sand bg-white overflow-hidden shadow-sm">
            {claimableLoading ? (
              <div className="p-8 text-center text-sm text-stone">Loading available tasks...</div>
            ) : claimable.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-espresso">No tasks available to claim right now</p>
                <p className="text-xs text-stone mt-1">Check back later for new tasks.</p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-parchment border-b border-sand">
                    <th className="w-8"></th>
                    <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-4 py-3 text-left">Task</th>
                    <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-4 py-3 text-left">Account / Objective</th>
                    <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-4 py-3 text-left">Rate</th>
                    <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-4 py-3 text-left">Type</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {claimable.map((t) => {
                    const taskName = t.custom_task_name ?? t.task_library?.task_name ?? "Unknown Task";
                    const account = t.project_tags?.account ?? "";
                    const project = t.project_tags?.project_name ?? "";
                    const rate = t.task_rate ?? t.task_library?.default_rate ?? null;
                    const rowKey = `c-${t.id}`;
                    const isExpanded = expandedId === rowKey;

                    return (
                      <React.Fragment key={rowKey}>
                        <tr
                          onClick={() => handleExpand(rowKey)}
                          className={`border-b border-sand cursor-pointer group transition-colors hover:bg-parchment/30 ${isExpanded ? "bg-parchment/20" : ""}`}
                        >
                          <td className="px-3 py-3 w-8">
                            <svg
                              className={`h-4 w-4 text-stone transition-transform ${isExpanded ? "rotate-90" : ""}`}
                              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-medium text-espresso">{taskName}</span>
                            {t.instructions && (
                              <span className="ml-2 text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">Has instructions</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-stone">
                            {account || "—"}
                            {project ? <span className="text-stone/60"> / {project}</span> : ""}
                          </td>
                          <td className="px-4 py-3">
                            {rate != null ? (
                              <span className="text-sm font-semibold text-sage">${Number(rate).toFixed(2)}</span>
                            ) : (
                              <span className="text-sm text-stone/40">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">
                              Fixed Rate
                            </span>
                          </td>
                          <td className="px-3 py-3 w-8">
                            <svg className="h-3.5 w-3.5 text-stone/40 group-hover:text-stone transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
                            </svg>
                          </td>
                        </tr>
                        {isExpanded && renderClaimableDetail(t)}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
