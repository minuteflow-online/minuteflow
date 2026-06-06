"use client";

import { useEffect, useState, useCallback } from "react";

interface VaFeedback {
  id: number;
  user_id: string;
  subject: string;
  message: string;
  category: string;
  feedback_type: string | null;
  regarding: string | null;
  reason: string | null;
  background_context: string | null;
  status: "new" | "reviewed" | "actioned";
  admin_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  submitter_name?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: "General", suggestion: "Suggestion", concern: "Concern", appreciation: "Appreciation",
};

const FEEDBACK_TYPE_LABELS: Record<string, string> = {
  general: "General",
  suggestion: "Suggestion",
  concern: "Concern",
  appreciation: "Appreciation",
  report_issue: "Report an Issue",
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  new:      { bg: "bg-amber-soft",  text: "text-amber",  label: "New"      },
  reviewed: { bg: "bg-parchment",   text: "text-walnut", label: "Reviewed" },
  actioned: { bg: "bg-sage-soft",   text: "text-sage",   label: "Actioned" },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function VaFeedbackAdminTab() {
  const [feedback, setFeedback] = useState<VaFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminNotes, setAdminNotes] = useState<Record<number, string>>({});
  const [processing, setProcessing] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<"all" | "new" | "reviewed" | "actioned">("all");

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/va-feedback");
      const d = await res.json();
      setFeedback(d.feedback || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFeedback(); }, [fetchFeedback]);

  const handleReview = useCallback(async (id: number, status: string) => {
    const key = `${id}-${status}`;
    setProcessing((p) => ({ ...p, [key]: true }));
    await fetch(`/api/va-feedback?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, admin_notes: adminNotes[id] || null }),
    });
    await fetchFeedback();
    setProcessing((p) => ({ ...p, [key]: false }));
  }, [adminNotes, fetchFeedback]);

  const filtered = filter === "all" ? feedback : feedback.filter((f) => f.status === filter);
  const newCount = feedback.filter((f) => f.status === "new").length;

  return (
    <div className="max-w-4xl space-y-6">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "new", "reviewed", "actioned"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all cursor-pointer ${
              filter === f ? "bg-terracotta text-white border-terracotta" : "bg-white text-walnut border-sand hover:border-terracotta"
            }`}
          >
            {f === "all" ? `All (${feedback.length})` : f === "new" ? `New (${newCount})` : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-stone">
          <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
          Loading feedback...
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-espresso">No feedback</p>
          <p className="mt-1 text-xs text-stone">Nothing matching this filter.</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-4">
          {filtered.map((f) => (
            <div key={f.id} className={`rounded-xl border bg-white p-5 shadow-sm ${f.status === "new" ? "border-amber" : "border-sand"}`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="text-sm font-semibold text-espresso">{f.submitter_name}</p>
                  <p className="text-sm font-medium text-espresso mt-0.5">{f.subject}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="inline-flex items-center rounded-full bg-parchment px-2 py-0.5 text-[11px] font-medium text-walnut">{CATEGORY_LABELS[f.category] || f.category}</span>
                    <span className="text-[11px] text-stone">{fmtDate(f.created_at)}</span>
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold shrink-0 ${STATUS_STYLES[f.status].bg} ${STATUS_STYLES[f.status].text}`}>
                  {STATUS_STYLES[f.status].label}
                </span>
              </div>

              {/* New structured fields */}
              {(f.feedback_type || f.regarding || f.reason || f.background_context) && (
                <div className="mt-2 space-y-1">
                  {f.feedback_type && f.feedback_type !== f.category && (
                    <span className="inline-flex items-center rounded-full bg-parchment px-2 py-0.5 text-[11px] font-medium text-walnut mr-2">
                      {FEEDBACK_TYPE_LABELS[f.feedback_type] || f.feedback_type}
                    </span>
                  )}
                  {f.regarding && (
                    <p className="text-[12px] text-walnut"><span className="font-semibold">Regarding:</span> {f.regarding}</p>
                  )}
                  {f.reason && (
                    <p className="text-[12px] text-walnut"><span className="font-semibold">Reason:</span> {f.reason}</p>
                  )}
                  {f.background_context && (
                    <p className="text-[12px] text-walnut"><span className="font-semibold">Background:</span> {f.background_context}</p>
                  )}
                </div>
              )}

              <p className="text-xs text-bark leading-relaxed mb-3">{f.message}</p>
              {f.admin_notes && <p className="text-xs text-stone italic mb-3">Note: &quot;{f.admin_notes}&quot;</p>}

              {f.status === "new" && (
                <>
                  <div className="mb-3">
                    <input
                      type="text" value={adminNotes[f.id] || ""}
                      onChange={(e) => setAdminNotes((n) => ({ ...n, [f.id]: e.target.value }))}
                      placeholder="Add a note (optional)..."
                      className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReview(f.id, "reviewed")} disabled={!!processing[`${f.id}-reviewed`]}
                      className="flex-1 py-2 rounded-lg bg-parchment border border-sand text-xs font-semibold text-walnut cursor-pointer transition-all hover:border-terracotta hover:text-terracotta disabled:opacity-50"
                    >
                      {processing[`${f.id}-reviewed`] ? "..." : "Mark Reviewed"}
                    </button>
                    <button
                      onClick={() => handleReview(f.id, "actioned")} disabled={!!processing[`${f.id}-actioned`]}
                      className="flex-1 py-2 rounded-lg bg-sage text-white text-xs font-semibold cursor-pointer transition-all hover:bg-[#4a8a6a] disabled:opacity-50"
                    >
                      {processing[`${f.id}-actioned`] ? "..." : "Mark Actioned"}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
