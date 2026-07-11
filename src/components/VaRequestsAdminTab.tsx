"use client";

import { useEffect, useState, useCallback } from "react";

type RequestType = "time_off" | "schedule_change" | "pay_question" | "general";
type RequestStatus = "pending" | "approved" | "denied" | "noted";

interface VaRequest {
  id: number;
  user_id: string;
  type: RequestType;
  subject: string;
  message: string;
  start_date: string | null;
  end_date: string | null;
  status: RequestStatus;
  admin_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  requester_name?: string;
}

const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  time_off: "Time Off",
  schedule_change: "Schedule Change",
  pay_question: "Pay Question",
  general: "General Request",
};

const STATUS_STYLES: Record<RequestStatus, { bg: string; text: string; label: string }> = {
  pending:  { bg: "bg-amber-soft",       text: "text-amber",      label: "Pending"  },
  approved: { bg: "bg-sage-soft",        text: "text-sage",       label: "Approved" },
  denied:   { bg: "bg-terracotta-soft",  text: "text-terracotta", label: "Denied"   },
  noted:    { bg: "bg-parchment",        text: "text-walnut",     label: "Noted"    },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function VaRequestsAdminTab() {
  const [requests, setRequests] = useState<VaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminNotes, setAdminNotes] = useState<Record<number, string>>({});
  const [processing, setProcessing] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/va-requests");
      const d = await res.json();
      setRequests(d.requests || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleReview = useCallback(async (id: number, status: RequestStatus) => {
    const key = `${id}-${status}`;
    setProcessing((p) => ({ ...p, [key]: true }));
    await fetch(`/api/va-requests?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, admin_notes: adminNotes[id] || null }),
    });
    await fetchRequests();
    setProcessing((p) => ({ ...p, [key]: false }));
  }, [adminNotes, fetchRequests]);

  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const filtered = filter === "pending" ? requests.filter((r) => r.status === "pending") : requests;

  return (
    <div className="max-w-4xl space-y-6">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["pending", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all cursor-pointer ${
              filter === f ? "bg-terracotta text-white border-terracotta" : "bg-white text-walnut border-sand hover:border-terracotta"
            }`}
          >
            {f === "pending" ? `Pending (${pendingCount})` : `All (${requests.length})`}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-stone">
          <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
          Loading requests...
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-espresso">No requests</p>
          <p className="mt-1 text-xs text-stone">Nothing matching this filter.</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-4">
          {filtered.map((r) => (
            <div key={r.id} className={`rounded-xl border bg-white p-5 shadow-sm ${r.status === "pending" ? "border-amber" : "border-sand"}`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="text-sm font-semibold text-espresso">{r.requester_name}</p>
                  <p className="text-sm font-medium text-espresso mt-0.5">{r.subject}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="inline-flex items-center rounded-full bg-parchment px-2 py-0.5 text-[11px] font-medium text-walnut">{REQUEST_TYPE_LABELS[r.type]}</span>
                    {r.start_date && (
                      <span className="text-[11px] text-stone">
                        {fmtDate(r.start_date)}{r.end_date && r.end_date !== r.start_date ? ` – ${fmtDate(r.end_date)}` : ""}
                      </span>
                    )}
                    <span className="text-[11px] text-stone">Submitted {fmtDate(r.created_at)}</span>
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold shrink-0 ${STATUS_STYLES[r.status].bg} ${STATUS_STYLES[r.status].text}`}>
                  {STATUS_STYLES[r.status].label}
                </span>
              </div>

              <p className="text-xs text-bark leading-relaxed mb-3">{r.message}</p>
              {r.admin_notes && <p className="text-xs text-stone italic mb-3">Note: &quot;{r.admin_notes}&quot;</p>}

              {r.status === "pending" && (
                <>
                  <div className="mb-3">
                    <input
                      type="text" value={adminNotes[r.id] || ""}
                      onChange={(e) => setAdminNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                      placeholder="Add a note (optional)..."
                      className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReview(r.id, "approved")} disabled={!!processing[`${r.id}-approved`]}
                      className="flex-1 py-2 rounded-lg bg-sage text-white text-xs font-semibold cursor-pointer transition-all hover:bg-[#4a8a6a] disabled:opacity-50"
                    >
                      {processing[`${r.id}-approved`] ? "..." : "Approve"}
                    </button>
                    <button
                      onClick={() => handleReview(r.id, "noted")} disabled={!!processing[`${r.id}-noted`]}
                      className="flex-1 py-2 rounded-lg bg-parchment border border-sand text-xs font-semibold text-walnut cursor-pointer transition-all hover:border-terracotta hover:text-terracotta disabled:opacity-50"
                    >
                      {processing[`${r.id}-noted`] ? "..." : "Note"}
                    </button>
                    <button
                      onClick={() => handleReview(r.id, "denied")} disabled={!!processing[`${r.id}-denied`]}
                      className="flex-1 py-2 rounded-lg bg-white border border-sand text-xs font-semibold text-bark cursor-pointer transition-all hover:border-terracotta hover:text-terracotta disabled:opacity-50"
                    >
                      {processing[`${r.id}-denied`] ? "..." : "Deny"}
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
