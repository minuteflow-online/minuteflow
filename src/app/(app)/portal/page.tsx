"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/database";
import VaBroadcastsPortalTab from "@/components/VaBroadcastsPortalTab";
import VAProfileTab from "@/components/VAProfileTab";

// ─── Types ───────────────────────────────────────────────────

type PortalTab = "profile" | "onboarding" | "sops" | "jobs" | "requests" | "paystubs" | "feedback" | "trainings" | "memos" | "coaching_notes" | "reviews" | "tokens" | "change_password";

type RequestType = "time_off" | "schedule_change" | "pay_question" | "general";
type RequestStatus = "pending" | "approved" | "denied" | "noted";

interface VaResource {
  id: string;
  type: string;
  title: string;
  content: string | null;
  url: string | null;
  sort_order: number;
  created_at: string;
}

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

// ─── Sidebar Tab Config ──────────────────────────────────────

const PORTAL_TABS: { id: PortalTab; label: string; icon: React.ReactNode }[] = [
  {
    id: "profile",
    label: "My Profile",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    id: "onboarding",
    label: "Start Here",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    id: "sops",
    label: "SOPs",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  {
    id: "jobs",
    label: "Job Postings",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
        <line x1="12" y1="12" x2="12" y2="16" />
        <line x1="10" y1="14" x2="14" y2="14" />
      </svg>
    ),
  },
  {
    id: "requests",
    label: "Requests",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
    ),
  },
  {
    id: "paystubs",
    label: "Paystubs",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
    ),
  },
  {
    id: "feedback",
    label: "Feedback",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
  },
  {
    id: "trainings",
    label: "Trainings",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
        <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
      </svg>
    ),
  },
  {
    id: "memos",
    label: "Memos",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    id: "coaching_notes",
    label: "Coaching Notes",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
      </svg>
    ),
  },
  {
    id: "reviews",
    label: "Reviews",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    id: "tokens",
    label: "Tokens & Ratings",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    id: "change_password",
    label: "Change Password",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
    ),
  },
];

// ─── Helpers ──────────────────────────────────────────────────

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

// ─── Resource Card ───────────────────────────────────────────

function ResourceCard({ resource }: { resource: VaResource }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = resource.content && resource.content.trim().length > 0;
  const contentPreview = hasContent && resource.content!.length > 200
    ? resource.content!.slice(0, 200) + "..."
    : resource.content;

  return (
    <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-espresso">{resource.title}</h3>
          {hasContent && (
            <div className="mt-2">
              <p className="text-xs text-bark leading-relaxed whitespace-pre-wrap">
                {expanded ? resource.content : contentPreview}
              </p>
              {resource.content!.length > 200 && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="mt-1 text-[11px] text-terracotta hover:underline cursor-pointer"
                >
                  {expanded ? "Show less" : "Read more"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {resource.url && (
        <a
          href={resource.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-terracotta hover:underline"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Open Link
        </a>
      )}
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 h-12 w-12 rounded-full bg-parchment flex items-center justify-center">
        <svg className="h-5 w-5 text-stone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <p className="text-sm font-medium text-espresso">No {label} yet</p>
      <p className="mt-1 text-xs text-stone">Check back soon — your admin will post content here.</p>
    </div>
  );
}

// ─── Resources Tab ───────────────────────────────────────────

function ResourcesTab({
  type,
  label,
  emptyLabel,
}: {
  type: string;
  label: string;
  emptyLabel: string;
}) {
  const [resources, setResources] = useState<VaResource[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/va-resources?type=${type}`)
      .then((r) => r.json())
      .then((d) => {
        setResources(d.resources || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [type]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading {label.toLowerCase()}...
      </div>
    );
  }

  if (resources.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }

  return (
    <div className="grid gap-4 max-w-3xl">
      {resources.map((r) => (
        <ResourceCard key={r.id} resource={r} />
      ))}
    </div>
  );
}

// ─── Requests Tab ────────────────────────────────────────────

function RequestsTab({
  currentUserId,
  isAdmin,
}: {
  currentUserId: string;
  isAdmin: boolean;
}) {
  const supabase = createClient();

  // ── Form state ──
  const [showForm, setShowForm] = useState(false);
  const [reqType, setReqType] = useState<RequestType>("time_off");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // ── List state ──
  const [requests, setRequests] = useState<VaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminNotes, setAdminNotes] = useState<Record<number, string>>({});
  const [processing, setProcessing] = useState<Record<string, boolean>>({});

  const fetchRequests = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("va_requests")
      .select("*")
      .order("created_at", { ascending: false });

    // VAs only see their own; admins see all
    if (!isAdmin) {
      query = query.eq("user_id", currentUserId);
    }

    const { data } = await query;

    if (isAdmin && data) {
      // Enrich with requester names
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name");
      const profileMap: Record<string, string> = {};
      (profiles || []).forEach((p: { id: string; full_name: string }) => {
        profileMap[p.id] = p.full_name;
      });
      setRequests(
        (data as VaRequest[]).map((r) => ({
          ...r,
          requester_name: profileMap[r.user_id] || "Unknown",
        }))
      );
    } else {
      setRequests((data as VaRequest[]) || []);
    }

    setLoading(false);
  }, [supabase, isAdmin, currentUserId]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // ── Submit new request ──
  const handleSubmit = useCallback(async () => {
    if (!subject.trim() || !message.trim()) return;
    setSubmitting(true);
    setSubmitMsg(null);

    const payload: Record<string, unknown> = {
      user_id: currentUserId,
      type: reqType,
      subject: subject.trim(),
      message: message.trim(),
    };
    if (reqType === "time_off") {
      if (startDate) payload.start_date = startDate;
      if (endDate) payload.end_date = endDate;
    }

    const { error } = await supabase.from("va_requests").insert(payload);
    setSubmitting(false);

    if (error) {
      setSubmitMsg({ type: "err", text: error.message });
      return;
    }

    // Reset form
    setSubject("");
    setMessage("");
    setStartDate("");
    setEndDate("");
    setShowForm(false);
    setSubmitMsg({ type: "ok", text: "Request submitted!" });
    setTimeout(() => setSubmitMsg(null), 3000);
    fetchRequests();
  }, [supabase, currentUserId, reqType, subject, message, startDate, endDate, fetchRequests]);

  // ── Admin review ──
  const handleReview = useCallback(
    async (req: VaRequest, status: RequestStatus) => {
      const key = `${req.id}-${status}`;
      setProcessing((p) => ({ ...p, [key]: true }));

      await supabase
        .from("va_requests")
        .update({
          status,
          admin_notes: adminNotes[req.id] || null,
          reviewed_by: currentUserId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", req.id);

      await fetchRequests();
      setProcessing((p) => ({ ...p, [key]: false }));
    },
    [supabase, currentUserId, adminNotes, fetchRequests]
  );

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const pastRequests = requests.filter((r) => r.status !== "pending");

  return (
    <div className="max-w-3xl space-y-8">

      {/* ── Submit Form (VAs + Admins can submit) ── */}
      {!showForm ? (
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840]"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Request
          </button>
          {submitMsg && (
            <p className={`text-xs font-medium ${submitMsg.type === "ok" ? "text-sage" : "text-red-500"}`}>
              {submitMsg.text}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-espresso">New Request</h3>
            <button
              onClick={() => setShowForm(false)}
              className="text-stone hover:text-espresso cursor-pointer"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Type */}
          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-walnut mb-2 tracking-wide">Request Type</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["time_off", "schedule_change", "pay_question", "general"] as RequestType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setReqType(t)}
                  className={`py-2 px-3 rounded-lg text-[12px] font-medium border transition-all cursor-pointer ${
                    reqType === t
                      ? "bg-terracotta text-white border-terracotta"
                      : "bg-white text-walnut border-sand hover:border-terracotta"
                  }`}
                >
                  {REQUEST_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Date range (Time Off only) */}
          {reqType === "time_off" && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">From</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">To</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                />
              </div>
            </div>
          )}

          {/* Subject */}
          <div className="mb-3">
            <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of your request"
              className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta placeholder:text-stone"
            />
          </div>

          {/* Message */}
          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Details</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Explain your request in detail..."
              className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta placeholder:text-stone resize-none"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSubmit}
              disabled={submitting || !subject.trim() || !message.trim()}
              className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Submitting..." : "Submit Request"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="text-xs text-stone hover:text-espresso cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center gap-2 py-6 text-sm text-stone">
          <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
          Loading requests...
        </div>
      )}

      {/* ── Pending requests (admin review OR VA view) ── */}
      {!loading && pendingRequests.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-bold text-espresso">
              {isAdmin ? "Pending Requests" : "Your Pending Requests"}
            </h2>
            <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[11px] font-semibold text-amber">
              {pendingRequests.length}
            </span>
          </div>

          <div className="space-y-4">
            {pendingRequests.map((req) => (
              <div key={req.id} className="rounded-xl border border-sand bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    {isAdmin && (
                      <p className="text-sm font-semibold text-espresso">{req.requester_name}</p>
                    )}
                    <p className={`text-sm font-semibold text-espresso ${isAdmin ? "mt-0.5" : ""}`}>
                      {req.subject}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="inline-flex items-center rounded-full bg-parchment px-2 py-0.5 text-[11px] font-medium text-walnut">
                        {REQUEST_TYPE_LABELS[req.type]}
                      </span>
                      {req.start_date && (
                        <span className="text-[11px] text-stone">
                          {fmtDate(req.start_date)}
                          {req.end_date && req.end_date !== req.start_date
                            ? ` – ${fmtDate(req.end_date)}`
                            : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold shrink-0 ${STATUS_STYLES[req.status].bg} ${STATUS_STYLES[req.status].text}`}>
                    {STATUS_STYLES[req.status].label}
                  </span>
                </div>

                <p className="text-xs text-bark leading-relaxed mb-3">{req.message}</p>
                <p className="text-[11px] text-stone mb-3">{fmtDate(req.created_at)}</p>

                {/* Admin actions */}
                {isAdmin && (
                  <>
                    <div className="mb-3">
                      <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">
                        Notes <span className="font-normal text-stone">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={adminNotes[req.id] || ""}
                        onChange={(e) =>
                          setAdminNotes((n) => ({ ...n, [req.id]: e.target.value }))
                        }
                        placeholder="Add a note for the VA..."
                        className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleReview(req, "approved")}
                        disabled={!!processing[`${req.id}-approved`]}
                        className="flex-1 py-2 rounded-lg bg-sage text-white text-xs font-semibold cursor-pointer transition-all hover:bg-[#4a8a6a] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {processing[`${req.id}-approved`] ? "..." : "Approve"}
                      </button>
                      <button
                        onClick={() => handleReview(req, "noted")}
                        disabled={!!processing[`${req.id}-noted`]}
                        className="flex-1 py-2 rounded-lg bg-parchment border border-sand text-xs font-semibold text-walnut cursor-pointer transition-all hover:border-terracotta hover:text-terracotta disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {processing[`${req.id}-noted`] ? "..." : "Note"}
                      </button>
                      <button
                        onClick={() => handleReview(req, "denied")}
                        disabled={!!processing[`${req.id}-denied`]}
                        className="flex-1 py-2 rounded-lg bg-white border border-sand text-xs font-semibold text-bark cursor-pointer transition-all hover:border-terracotta hover:text-terracotta disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {processing[`${req.id}-denied`] ? "..." : "Deny"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Past / Resolved requests ── */}
      {!loading && pastRequests.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-espresso mb-4">Past Requests</h2>
          <div className="space-y-3">
            {pastRequests.map((req) => (
              <div key={req.id} className="rounded-xl border border-sand bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {isAdmin && (
                      <p className="text-xs font-semibold text-espresso">{req.requester_name}</p>
                    )}
                    <p className="text-sm font-medium text-espresso truncate">{req.subject}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="inline-flex items-center rounded-full bg-parchment px-2 py-0.5 text-[11px] font-medium text-walnut">
                        {REQUEST_TYPE_LABELS[req.type]}
                      </span>
                      <span className="text-[11px] text-stone">{fmtDate(req.created_at)}</span>
                    </div>
                    {req.admin_notes && (
                      <p className="mt-2 text-xs text-bark italic">"{req.admin_notes}"</p>
                    )}
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold shrink-0 ${STATUS_STYLES[req.status].bg} ${STATUS_STYLES[req.status].text}`}>
                    {STATUS_STYLES[req.status].label}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Empty state ── */}
      {!loading && requests.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 h-12 w-12 rounded-full bg-parchment flex items-center justify-center">
            <svg className="h-5 w-5 text-stone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
          </div>
          <p className="text-sm font-medium text-espresso">
            {isAdmin ? "No requests yet" : "You haven't submitted any requests yet"}
          </p>
          <p className="mt-1 text-xs text-stone">
            {isAdmin ? "Team requests will appear here." : "Click \"New Request\" above to get started."}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── New Interfaces ──────────────────────────────────────────

interface VaFeedback {
  id: number;
  user_id: string;
  subject: string;
  message: string;
  category: string;
  status: "new" | "reviewed" | "actioned";
  admin_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  submitter_name?: string;
}

interface VaTraining {
  id: number;
  title: string;
  description: string | null;
  url: string | null;
  category: string;
  sort_order: number;
  created_at: string;
}

interface VaMemo {
  id: number;
  title: string;
  body: string;
  requires_confirmation: boolean;
  created_at: string;
  read_by_me: boolean;
  read_count?: number;
}

interface VaReview {
  id: number;
  user_id: string;
  title: string;
  period: string;
  overall_rating: number | null;
  strengths: string | null;
  improvements: string | null;
  comments: string | null;
  created_at: string;
  va_name?: string;
}

interface VaToken {
  id: number;
  user_id: string;
  amount: number;
  reason: string;
  awarded_at: string;
  va_name?: string;
}

interface VaDailyRating {
  id: number;
  va_id: string;
  score: number;
  notes: string | null;
  rating_date: string;
  va_name?: string;
}

const FEEDBACK_CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  suggestion: "Suggestion",
  concern: "Concern",
  appreciation: "Appreciation",
};

const FEEDBACK_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  new:      { bg: "bg-amber-soft",      text: "text-amber",      label: "New"      },
  reviewed: { bg: "bg-parchment",       text: "text-walnut",     label: "Reviewed" },
  actioned: { bg: "bg-sage-soft",       text: "text-sage",       label: "Actioned" },
};

// ─── Feedback Tab ─────────────────────────────────────────────

function FeedbackTab({ currentUserId, isAdmin }: { currentUserId: string; isAdmin: boolean }) {
  const [feedback, setFeedback] = useState<VaFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState("general");
  const [feedbackType, setFeedbackType] = useState("general");
  const [regarding, setRegarding] = useState("");
  const [reason, setReason] = useState("");
  const [backgroundContext, setBackgroundContext] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [adminNotes, setAdminNotes] = useState<Record<number, string>>({});
  const [processing, setProcessing] = useState<Record<string, boolean>>({});

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

  const handleSubmit = useCallback(async () => {
    if (!subject.trim() || !message.trim()) return;
    setSubmitting(true);
    setSubmitMsg(null);
    const res = await fetch("/api/va-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: subject.trim(), message: message.trim(), category, feedback_type: feedbackType, regarding: regarding.trim() || undefined, reason: reason.trim() || undefined, background_context: backgroundContext.trim() || undefined }),
    });
    setSubmitting(false);
    if (res.ok) {
      setSubject(""); setMessage(""); setShowForm(false);
      setRegarding(""); setReason(""); setBackgroundContext(""); setFeedbackType("general");
      setSubmitMsg({ type: "ok", text: "Feedback submitted. Thank you!" });
      setTimeout(() => setSubmitMsg(null), 3000);
      fetchFeedback();
    } else {
      const e = await res.json();
      setSubmitMsg({ type: "err", text: e.error || "Failed to submit" });
    }
  }, [subject, message, category, fetchFeedback]);

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

  const newFeedback = feedback.filter((f) => f.status === "new");
  const pastFeedback = feedback.filter((f) => f.status !== "new");

  return (
    <div className="max-w-3xl space-y-8">
      {!showForm ? (
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840]"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Share Feedback
          </button>
          {submitMsg && (
            <p className={`text-xs font-medium ${submitMsg.type === "ok" ? "text-sage" : "text-red-500"}`}>{submitMsg.text}</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-espresso">Share Feedback</h3>
            <button onClick={() => setShowForm(false)} className="text-stone hover:text-espresso cursor-pointer">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-walnut mb-2 tracking-wide">Type</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {([
                { value: "general", label: "General" },
                { value: "suggestion", label: "Suggestion" },
                { value: "report_issue", label: "Report an Issue" },
                { value: "appreciation", label: "Appreciation" },
                { value: "concern", label: "Concern" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFeedbackType(opt.value)}
                  className={`rounded-lg py-2 px-3 text-[12px] font-medium border transition-all cursor-pointer ${
                    feedbackType === opt.value
                      ? "bg-terracotta text-white border-terracotta"
                      : "bg-white text-walnut border-sand hover:border-terracotta"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Regarding</label>
            <input
              type="text"
              value={regarding}
              onChange={(e) => setRegarding(e.target.value)}
              placeholder="Person, thing, or item of concern..."
              className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
            />
          </div>
          <div className="mb-3">
            <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Subject</label>
            <input
              type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary"
              className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta placeholder:text-stone"
            />
          </div>
          <div className="mb-3">
            <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Reason</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you submitting this?"
              className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
            />
          </div>
          <div className="mb-3">
            <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Background / Context</label>
            <textarea
              value={backgroundContext}
              onChange={(e) => setBackgroundContext(e.target.value)}
              rows={3}
              placeholder="Any background or context..."
              className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta resize-none"
            />
          </div>
          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Message</label>
            <textarea
              value={message} onChange={(e) => setMessage(e.target.value)} rows={4}
              placeholder="Share your thoughts..."
              className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta placeholder:text-stone resize-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSubmit} disabled={submitting || !subject.trim() || !message.trim()}
              className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Submitting..." : "Submit Feedback"}
            </button>
            <button onClick={() => setShowForm(false)} className="text-xs text-stone hover:text-espresso cursor-pointer">Cancel</button>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-6 text-sm text-stone">
          <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />Loading...
        </div>
      )}

      {!loading && isAdmin && newFeedback.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-bold text-espresso">New Feedback</h2>
            <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[11px] font-semibold text-amber">{newFeedback.length}</span>
          </div>
          <div className="space-y-4">
            {newFeedback.map((f) => (
              <div key={f.id} className="rounded-xl border border-sand bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    {isAdmin && <p className="text-sm font-semibold text-espresso">{f.submitter_name}</p>}
                    <p className="text-sm font-semibold text-espresso mt-0.5">{f.subject}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="inline-flex items-center rounded-full bg-parchment px-2 py-0.5 text-[11px] font-medium text-walnut">{FEEDBACK_CATEGORY_LABELS[f.category] || f.category}</span>
                      <span className="text-[11px] text-stone">{fmtDate(f.created_at)}</span>
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold shrink-0 ${FEEDBACK_STATUS_STYLES[f.status].bg} ${FEEDBACK_STATUS_STYLES[f.status].text}`}>
                    {FEEDBACK_STATUS_STYLES[f.status].label}
                  </span>
                </div>
                <p className="text-xs text-bark leading-relaxed mb-3">{f.message}</p>
                {isAdmin && (
                  <>
                    <div className="mb-3">
                      <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Notes <span className="font-normal text-stone">(optional)</span></label>
                      <input
                        type="text" value={adminNotes[f.id] || ""} onChange={(e) => setAdminNotes((n) => ({ ...n, [f.id]: e.target.value }))}
                        placeholder="Add a note..."
                        className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleReview(f.id, "reviewed")} disabled={!!processing[`${f.id}-reviewed`]}
                        className="flex-1 py-2 rounded-lg bg-parchment border border-sand text-xs font-semibold text-walnut cursor-pointer transition-all hover:border-terracotta hover:text-terracotta disabled:opacity-50">
                        {processing[`${f.id}-reviewed`] ? "..." : "Mark Reviewed"}
                      </button>
                      <button onClick={() => handleReview(f.id, "actioned")} disabled={!!processing[`${f.id}-actioned`]}
                        className="flex-1 py-2 rounded-lg bg-sage text-white text-xs font-semibold cursor-pointer transition-all hover:bg-[#4a8a6a] disabled:opacity-50">
                        {processing[`${f.id}-actioned`] ? "..." : "Mark Actioned"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && pastFeedback.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-espresso mb-4">{isAdmin ? "Past Feedback" : "Your Past Feedback"}</h2>
          <div className="space-y-3">
            {pastFeedback.map((f) => (
              <div key={f.id} className="rounded-xl border border-sand bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {isAdmin && <p className="text-xs font-semibold text-espresso">{f.submitter_name}</p>}
                    <p className="text-sm font-medium text-espresso truncate">{f.subject}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="inline-flex items-center rounded-full bg-parchment px-2 py-0.5 text-[11px] font-medium text-walnut">{FEEDBACK_CATEGORY_LABELS[f.category] || f.category}</span>
                      <span className="text-[11px] text-stone">{fmtDate(f.created_at)}</span>
                    </div>
                    {f.admin_notes && <p className="mt-2 text-xs text-bark italic">&quot;{f.admin_notes}&quot;</p>}
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold shrink-0 ${FEEDBACK_STATUS_STYLES[f.status].bg} ${FEEDBACK_STATUS_STYLES[f.status].text}`}>
                    {FEEDBACK_STATUS_STYLES[f.status].label}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && feedback.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 h-12 w-12 rounded-full bg-parchment flex items-center justify-center">
            <svg className="h-5 w-5 text-stone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-espresso">{isAdmin ? "No feedback yet" : "No feedback submitted yet"}</p>
          <p className="mt-1 text-xs text-stone">{isAdmin ? "Team feedback will appear here." : "Click \"Share Feedback\" above to get started."}</p>
        </div>
      )}
    </div>
  );
}

// ─── Reviews Tab ──────────────────────────────────────────────

function ReviewsTab({ isAdmin }: { isAdmin: boolean }) {
  const [reviews, setReviews] = useState<VaReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  useEffect(() => {
    fetch("/api/va-reviews")
      .then((r) => r.json())
      .then((d) => { setReviews(d.reviews || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const STARS = [1, 2, 3, 4, 5];

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading reviews...
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-3 h-12 w-12 rounded-full bg-parchment flex items-center justify-center">
          <svg className="h-5 w-5 text-stone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </div>
        <p className="text-sm font-medium text-espresso">No reviews yet</p>
        <p className="mt-1 text-xs text-stone">Performance reviews will appear here once they&apos;re published.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      {reviews.map((r) => (
        <div key={r.id} className="rounded-xl border border-sand bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              {isAdmin && <p className="text-sm font-semibold text-espresso">{r.va_name}</p>}
              <h3 className={`text-sm font-semibold text-espresso ${isAdmin ? "mt-0.5" : ""}`}>{r.title}</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="inline-flex items-center rounded-full bg-parchment px-2 py-0.5 text-[11px] font-medium text-walnut">{r.period}</span>
                <span className="text-[11px] text-stone">{fmtDate(r.created_at)}</span>
              </div>
            </div>
            {r.overall_rating && (
              <div className="flex items-center gap-0.5 shrink-0">
                {STARS.map((s) => (
                  <svg key={s} className={`h-4 w-4 ${s <= r.overall_rating! ? "text-amber fill-current" : "text-sand"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                ))}
              </div>
            )}
          </div>

          {expanded[r.id] && (
            <div className="space-y-3 mt-3 pt-3 border-t border-parchment">
              {r.strengths && (
                <div>
                  <p className="text-[11px] font-semibold text-walnut mb-1 tracking-wide">Strengths</p>
                  <p className="text-xs text-bark leading-relaxed">{r.strengths}</p>
                </div>
              )}
              {r.improvements && (
                <div>
                  <p className="text-[11px] font-semibold text-walnut mb-1 tracking-wide">Areas to Improve</p>
                  <p className="text-xs text-bark leading-relaxed">{r.improvements}</p>
                </div>
              )}
              {r.comments && (
                <div>
                  <p className="text-[11px] font-semibold text-walnut mb-1 tracking-wide">Additional Comments</p>
                  <p className="text-xs text-bark leading-relaxed">{r.comments}</p>
                </div>
              )}
            </div>
          )}

          {(r.strengths || r.improvements || r.comments) && (
            <button
              onClick={() => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))}
              className="mt-3 text-[11px] text-terracotta hover:underline cursor-pointer"
            >
              {expanded[r.id] ? "Show less" : "Read full review"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Tokens Tab ───────────────────────────────────────────────

function TokensTab({ currentUserId, isAdmin }: { currentUserId: string; isAdmin: boolean }) {
  const [tokens, setTokens] = useState<VaToken[]>([]);
  const [ratings, setRatings] = useState<VaDailyRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"overview" | "tokens" | "ratings">("overview");

  useEffect(() => {
    Promise.all([
      fetch("/api/va-tokens").then((r) => r.json()),
      fetch("/api/va-ratings").then((r) => r.json()),
    ]).then(([tokData, ratData]) => {
      setTokens(tokData.tokens || []);
      setRatings(ratData.ratings || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const totalTokens = tokens.reduce((sum, t) => sum + t.amount, 0);
  const avgRating = ratings.length > 0
    ? (ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length).toFixed(1)
    : null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading tokens & ratings...
      </div>
    );
  }

  // ── Back button shared across sub-views ──
  const BackButton = () => (
    <button
      onClick={() => setView("overview")}
      className="flex items-center gap-1.5 text-[12px] font-semibold text-walnut hover:text-espresso transition-colors mb-4"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Back to Overview
    </button>
  );

  // ── Tokens-only sub-view ──
  if (view === "tokens") {
    return (
      <div className="max-w-3xl">
        <BackButton />
        <div className="space-y-5">
          {/* Total Tokens summary card */}
          <div className="rounded-xl border border-sand bg-white p-5 shadow-sm text-center w-full max-w-xs">
            <p className="text-3xl font-bold text-terracotta">{totalTokens}</p>
            <p className="text-[11px] font-semibold text-walnut mt-1 tracking-wide">TOTAL TOKENS</p>
          </div>

          {/* Itemized token awards */}
          {tokens.length > 0 ? (
            <section>
              <h2 className="text-sm font-bold text-espresso mb-3">Token Awards</h2>
              <div className="space-y-2">
                {tokens.map((t) => (
                  <div key={t.id} className="rounded-xl border border-sand bg-white p-4 shadow-sm flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      {isAdmin && <p className="text-xs font-semibold text-espresso">{t.va_name}</p>}
                      <p className="text-sm font-medium text-espresso truncate">{t.reason}</p>
                      <p className="text-[11px] text-stone mt-0.5">{fmtDate(t.awarded_at)}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-terracotta px-3 py-1 text-sm font-bold text-white">+{t.amount}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-3 h-12 w-12 rounded-full bg-parchment flex items-center justify-center">
                <svg className="h-5 w-5 text-stone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="8" r="6" /><path d="M8.21 13.89L7 23l5-3 5 3-1.21-9.12" />
                </svg>
              </div>
              <p className="text-sm font-medium text-espresso">No tokens yet</p>
              <p className="mt-1 text-xs text-stone">Token awards will appear here when granted.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Ratings-only sub-view ──
  if (view === "ratings") {
    return (
      <div className="max-w-3xl">
        <BackButton />
        <div className="space-y-5">
          {/* Avg Rating summary card */}
          <div className="rounded-xl border border-sand bg-white p-5 shadow-sm text-center w-full max-w-xs">
            {avgRating ? (
              <>
                <p className="text-3xl font-bold text-terracotta">{avgRating}</p>
                <div className="flex justify-center gap-0.5 mt-1">
                  {[1,2,3,4,5].map((s) => (
                    <svg key={s} className={`h-3.5 w-3.5 ${s <= Math.round(parseFloat(avgRating)) ? "text-amber fill-current" : "text-sand"}`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  ))}
                </div>
                <p className="text-[11px] font-semibold text-walnut mt-1 tracking-wide">AVG RATING</p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-stone">—</p>
                <p className="text-[11px] font-semibold text-walnut mt-1 tracking-wide">AVG RATING</p>
              </>
            )}
          </div>

          {/* Daily ratings list */}
          {ratings.length > 0 ? (
            <section>
              <h2 className="text-sm font-bold text-espresso mb-3">Performance Ratings</h2>
              <div className="space-y-2">
                {ratings.map((r) => (
                  <div key={r.id} className="rounded-xl border border-sand bg-white p-4 shadow-sm flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      {isAdmin && <p className="text-xs font-semibold text-espresso">{r.va_name}</p>}
                      <p className="text-sm font-medium text-espresso">{new Date(r.rating_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</p>
                      {r.notes && <p className="text-xs text-stone mt-0.5 truncate">{r.notes}</p>}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {[1,2,3,4,5].map((s) => (
                        <svg key={s} className={`h-4 w-4 ${s <= r.score ? "text-amber fill-current" : "text-sand"}`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-3 h-12 w-12 rounded-full bg-parchment flex items-center justify-center">
                <svg className="h-5 w-5 text-stone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <p className="text-sm font-medium text-espresso">No ratings yet</p>
              <p className="mt-1 text-xs text-stone">Performance ratings will appear here.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Overview (default) — combined view with clickable summary cards ──
  return (
    <div className="max-w-3xl space-y-6">
      {/* Clickable summary cards side by side */}
      <div className="grid grid-cols-2 gap-4">
        {/* Total Tokens card → navigates to tokens sub-view */}
        <button
          onClick={() => setView("tokens")}
          className="rounded-xl border border-sand bg-white p-5 shadow-sm text-center hover:border-terracotta/40 hover:shadow-md transition-all group"
        >
          <p className="text-3xl font-bold text-terracotta">{totalTokens}</p>
          <p className="text-[11px] font-semibold text-walnut mt-1 tracking-wide">TOTAL TOKENS</p>
          <p className="text-[10px] text-stone mt-2 group-hover:text-bark transition-colors">Tap to view awards →</p>
        </button>

        {/* Avg Rating card → navigates to ratings sub-view */}
        <button
          onClick={() => setView("ratings")}
          className="rounded-xl border border-sand bg-white p-5 shadow-sm text-center hover:border-terracotta/40 hover:shadow-md transition-all group"
        >
          {avgRating ? (
            <>
              <p className="text-3xl font-bold text-terracotta">{avgRating}</p>
              <div className="flex justify-center gap-0.5 mt-1">
                {[1,2,3,4,5].map((s) => (
                  <svg key={s} className={`h-3.5 w-3.5 ${s <= Math.round(parseFloat(avgRating)) ? "text-amber fill-current" : "text-sand"}`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                ))}
              </div>
            </>
          ) : (
            <p className="text-2xl font-bold text-stone">—</p>
          )}
          <p className="text-[11px] font-semibold text-walnut mt-1 tracking-wide">AVG RATING</p>
          <p className="text-[10px] text-stone mt-2 group-hover:text-bark transition-colors">Tap to view ratings →</p>
        </button>
      </div>

      {/* Token Awards list */}
      <section>
        <h2 className="text-xs font-bold text-espresso uppercase tracking-wide mb-3">Token Awards</h2>
        {tokens.length > 0 ? (
          <div className="space-y-2">
            {tokens.map((t) => (
              <div key={t.id} className="rounded-xl border border-sand bg-white p-4 shadow-sm flex items-center justify-between gap-3">
                <div className="min-w-0">
                  {isAdmin && <p className="text-xs font-semibold text-espresso">{t.va_name}</p>}
                  <p className="text-sm font-medium text-espresso truncate">{t.reason}</p>
                  <p className="text-[11px] text-stone mt-0.5">{fmtDate(t.awarded_at)}</p>
                </div>
                <span className="shrink-0 rounded-full bg-terracotta px-3 py-1 text-sm font-bold text-white">+{t.amount}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-stone">No token awards yet.</p>
        )}
      </section>

      {/* Performance Ratings list */}
      <section>
        <h2 className="text-xs font-bold text-espresso uppercase tracking-wide mb-3">Performance Ratings</h2>
        {ratings.length > 0 ? (
          <div className="space-y-2">
            {ratings.map((r) => (
              <div key={r.id} className="rounded-xl border border-sand bg-white p-4 shadow-sm flex items-center justify-between gap-3">
                <div className="min-w-0">
                  {isAdmin && <p className="text-xs font-semibold text-espresso">{r.va_name}</p>}
                  <p className="text-sm font-medium text-espresso">{new Date(r.rating_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</p>
                  {r.notes && <p className="text-xs text-stone mt-0.5 truncate">{r.notes}</p>}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {[1,2,3,4,5].map((s) => (
                    <svg key={s} className={`h-4 w-4 ${s <= r.score ? "text-amber fill-current" : "text-sand"}`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-stone">No ratings yet.</p>
        )}
      </section>
    </div>
  );
}

// ─── Paystubs Tab ────────────────────────────────────────────

interface PaystubRecord {
  id: string;
  pay_period_label: string;
  sent_at: string;
  amount_paid: number;
  gross_pay: number;
  payment_method: string | null;
  paystub_link: string | null;
  period_start: string | null;
  period_end: string | null;
  total_hours_ms: number | null;
  pay_rate: number | null;
  confirmation_number: string | null;
}

interface PerTaskEarning {
  id: number;
  rate: number | null;
  status: string;
  assigned_at: string;
  project_task_assignments: {
    id: number;
    custom_task_name: string | null;
    task_library: { id: number; task_name: string } | null;
    project_tags: { id: number; account: string; project_name: string } | null;
  } | null;
}

const PER_TASK_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-700" },
  completed: { label: "Completed", cls: "bg-green-100 text-green-800" },
  paid: { label: "Paid", cls: "bg-purple-100 text-purple-700" },
};

function PaystubsTab({ currentUserId }: { currentUserId: string }) {
  const supabase = createClient();
  const [paystubs, setPaystubs] = useState<PaystubRecord[]>([]);
  const [perTaskEarnings, setPerTaskEarnings] = useState<PerTaskEarning[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [paystubRes, perTaskRes] = await Promise.all([
          supabase
            .from("paystub_snapshots")
            .select("id, pay_period_label, sent_at, amount_paid, gross_pay, payment_method, paystub_link, period_start, period_end, total_hours_ms, pay_rate, confirmation_number")
            .eq("user_id", currentUserId)
            .order("sent_at", { ascending: false }),
          supabase
            .from("va_task_assignments")
            .select(
              "id, rate, status, assigned_at, project_task_assignments(id, custom_task_name, task_library(id, task_name), project_tags(id, account, project_name))"
            )
            .eq("va_id", currentUserId)
            .eq("billing_type", "fixed")
            .in("status", ["approved", "completed", "paid"])
            .order("assigned_at", { ascending: false }),
        ]);
        setPaystubs((paystubRes.data as PaystubRecord[]) || []);
        setPerTaskEarnings(((perTaskRes.data ?? []) as unknown) as PerTaskEarning[]);
      } catch {
        // non-fatal
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [supabase, currentUserId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading...
      </div>
    );
  }

  const pendingPayout = perTaskEarnings
    .filter((e) => e.status === "approved" || e.status === "completed")
    .reduce((sum, e) => sum + (e.rate ?? 0), 0);

  return (
    <div className="max-w-2xl space-y-8">

      {/* ── Per-Task Earnings ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-bold text-espresso">Per-Task Earnings</h3>
          {pendingPayout > 0 && (
            <span className="text-xs font-semibold text-sage bg-sage-soft px-3 py-1 rounded-full">
              {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(pendingPayout)} pending payout
            </span>
          )}
        </div>
        {perTaskEarnings.length === 0 ? (
          <p className="text-sm text-stone italic py-2">No approved per-task earnings yet.</p>
        ) : (
          <div className="rounded-xl border border-sand bg-white overflow-hidden shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="bg-parchment border-b border-sand">
                  <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-4 py-3 text-left">Task</th>
                  <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-4 py-3 text-left">Account</th>
                  <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-4 py-3 text-right">Rate</th>
                  <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {perTaskEarnings.map((e) => {
                  const taskName =
                    e.project_task_assignments?.custom_task_name ??
                    e.project_task_assignments?.task_library?.task_name ??
                    "Task";
                  const account = e.project_task_assignments?.project_tags?.account ?? "";
                  const project = e.project_task_assignments?.project_tags?.project_name ?? "";
                  const { label, cls } = PER_TASK_STATUS_MAP[e.status] ?? {
                    label: e.status,
                    cls: "bg-stone/10 text-stone",
                  };
                  return (
                    <tr key={e.id} className="border-b border-sand last:border-0">
                      <td className="px-4 py-3 text-sm font-medium text-espresso">{taskName}</td>
                      <td className="px-4 py-3 text-sm text-stone">
                        {account || "—"}
                        {project ? <span className="text-stone/60"> / {project}</span> : ""}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-sage text-right">
                        {e.rate != null
                          ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(e.rate)
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
                          {label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Paystubs ── */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-espresso">Paystubs</h3>
        {paystubs.length === 0 ? (
          <p className="text-sm text-stone italic py-2">No paystubs yet.</p>
        ) : (
          <div className="space-y-3">
            {paystubs.map((p) => {
              const fmtCurrency = (v: number | null | undefined) =>
                v != null
                  ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v)
                  : "—";
              const fmtDate = (d: string | null) =>
                d
                  ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : null;
              const periodLabel =
                p.period_start && p.period_end
                  ? `${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}`
                  : null;
              const hoursLabel =
                p.total_hours_ms != null
                  ? `${(p.total_hours_ms / 3600000).toFixed(2)}h`
                  : "—";
              return (
                <div key={p.id} className="rounded-xl border border-sand bg-white shadow-sm overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-espresso truncate">{p.pay_period_label}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-stone">
                          {new Date(p.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                        {p.payment_method && (
                          <span className="text-[11px] capitalize rounded-full bg-parchment px-2 py-0.5 text-walnut font-medium">
                            {p.payment_method.replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-sm font-bold text-terracotta shrink-0">
                      {fmtCurrency(p.amount_paid)}
                    </span>
                  </div>

                  {/* Details grid */}
                  <div className="border-t border-sand px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-2">
                    {periodLabel && (
                      <>
                        <div>
                          <p className="text-[10px] font-semibold text-walnut uppercase tracking-wide">Period</p>
                          <p className="text-[13px] text-espresso">{periodLabel}</p>
                        </div>
                        <div />
                      </>
                    )}
                    <div>
                      <p className="text-[10px] font-semibold text-walnut uppercase tracking-wide">Hours</p>
                      <p className="text-[13px] text-espresso">{hoursLabel}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-walnut uppercase tracking-wide">Pay Rate</p>
                      <p className="text-[13px] text-espresso">
                        {p.pay_rate != null ? `${fmtCurrency(p.pay_rate)}/hr` : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-walnut uppercase tracking-wide">Gross Pay</p>
                      <p className="text-[13px] text-espresso">{fmtCurrency(p.gross_pay)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-walnut uppercase tracking-wide">Amount Paid</p>
                      <p className="text-[13px] text-espresso">{fmtCurrency(p.amount_paid)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-walnut uppercase tracking-wide">Confirmation #</p>
                      <p className="text-[13px] text-espresso">{p.confirmation_number || "—"}</p>
                    </div>
                  </div>

                  {/* Footer: Download / View buttons */}
                  {p.paystub_link && (
                    <div className="border-t border-sand px-4 py-3 flex items-center gap-3">
                      <a
                        href={p.paystub_link}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-sage px-3 py-1.5 text-xs font-semibold text-white hover:bg-sage/90 transition-colors"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Download PDF
                      </a>
                      <a
                        href={p.paystub_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-parchment border border-sand px-3 py-1.5 text-xs font-semibold text-walnut hover:bg-sand transition-colors"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                        View
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}

// ─── Change Password Tab ──────────────────────────────────────

function PortalChangePasswordTab() {
  const supabase = createClient();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const handlePasswordChange = useCallback(async () => {
    if (!newPassword || newPassword.length < 6) {
      setPwMsg({ type: "err", text: "Password must be at least 6 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMsg({ type: "err", text: "Passwords don't match." });
      return;
    }

    setPwSaving(true);
    setPwMsg(null);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwSaving(false);

    if (error) {
      setPwMsg({ type: "err", text: error.message });
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    setPwMsg({ type: "ok", text: "Password updated!" });
    setTimeout(() => setPwMsg(null), 3000);
  }, [supabase, newPassword, confirmPassword]);

  return (
    <div className="max-w-sm rounded-xl border border-sand bg-white p-6 shadow-sm">
      {pwMsg?.type === "ok" && (
        <div className="mb-4 rounded-lg border border-sage bg-sage-soft px-4 py-2.5 text-xs font-medium text-sage">
          {pwMsg.text}
        </div>
      )}
      {pwMsg?.type === "err" && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-600">
          {pwMsg.text}
        </div>
      )}

      <div className="mb-4">
        <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-walnut">
          New Password
        </label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Min. 6 characters"
          className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
        />
      </div>

      <div className="mb-4">
        <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-walnut">
          Confirm Password
        </label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Repeat new password"
          className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
        />
      </div>

      <button
        onClick={handlePasswordChange}
        disabled={pwSaving || !newPassword || !confirmPassword}
        className="rounded-lg bg-terracotta px-6 py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pwSaving ? "Updating..." : "Update Password"}
      </button>
    </div>
  );
}

// ─── Main Portal Page ────────────────────────────────────────

export default function VaPortalPage() {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<PortalTab>("profile");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (data) setProfile(data as Profile);
      setLoading(false);
    }
    load();
  }, [supabase]);

  const isAdmin = profile?.role === "admin";

  const tabLabel: Record<PortalTab, string> = {
    profile: "My Profile",
    onboarding: "Start Here",
    sops: "SOPs",
    jobs: "Job Postings",
    requests: "Requests",
    paystubs: "Paystubs",
    feedback: "Feedback",
    trainings: "Trainings",
    memos: "Memos",
    coaching_notes: "Coaching Notes",
    reviews: "Reviews",
    tokens: "Tokens & Ratings",
    change_password: "Change Password",
  };

  const tabSubtitle: Record<PortalTab, string> = {
    profile: "Edit your personal info and payment details",
    onboarding: "Everything you need to get started",
    sops: "Standard operating procedures for your role",
    jobs: "Open positions and opportunities",
    requests: isAdmin ? "Review and respond to team requests" : "Submit and track your requests",
    paystubs: "Your payment history and paystub records",
    feedback: isAdmin ? "Review feedback from your team" : "Share feedback with the team",
    trainings: "Training materials and resources from admin",
    memos: "Memos from admin — team updates and announcements",
    coaching_notes: "Coaching and performance notes from your supervisor",
    reviews: isAdmin ? "Manage performance reviews" : "Your performance reviews",
    tokens: isAdmin ? "Award tokens and rate performance" : "Your tokens and performance ratings",
    change_password: "Update your account password",
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-56px)]">
      {/* ─── Left Sidebar ───────────────────────────────────── */}
      <aside className="w-56 shrink-0 border-r border-sand bg-parchment">
        <div className="sticky top-14 pt-4 pb-6">
          {/* Portal header */}
          <div className="px-4 pb-3 border-b border-sand mb-3">
            <p className="text-[11px] font-bold text-stone tracking-widest uppercase">Portal</p>
            {profile && (
              <p className="text-xs font-medium text-espresso mt-0.5 truncate">{profile.full_name}</p>
            )}
          </div>

          <nav className="space-y-0.5 px-2">
            {PORTAL_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
                    isActive
                      ? "bg-terracotta text-white"
                      : "text-walnut hover:bg-sand hover:text-espresso"
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* ─── Main Content ───────────────────────────────────── */}
      <main className="flex-1 min-w-0 p-8">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-espresso">{tabLabel[activeTab]}</h1>
          <p className="text-sm text-stone mt-0.5">{tabSubtitle[activeTab]}</p>
        </div>

        {/* Tab content */}
        {activeTab === "profile" && profile && (
          <VAProfileTab profile={profile} onSaved={setProfile} />
        )}
        {activeTab === "onboarding" && (
          <VaBroadcastsPortalTab category="onboarding" />
        )}
        {activeTab === "sops" && (
          <ResourcesTab type="sop" label="SOPs" emptyLabel="SOPs" />
        )}
        {activeTab === "jobs" && (
          <VaBroadcastsPortalTab category="job_posting" />
        )}
        {activeTab === "requests" && currentUserId && (
          <RequestsTab currentUserId={currentUserId} isAdmin={isAdmin} />
        )}
        {activeTab === "paystubs" && currentUserId && (
          <PaystubsTab currentUserId={currentUserId} />
        )}
        {activeTab === "feedback" && currentUserId && (
          <FeedbackTab currentUserId={currentUserId} isAdmin={isAdmin} />
        )}
        {activeTab === "trainings" && (
          <VaBroadcastsPortalTab category="training" />
        )}
        {activeTab === "memos" && (
          <VaBroadcastsPortalTab category="memo" />
        )}
        {activeTab === "coaching_notes" && (
          <VaBroadcastsPortalTab category="coaching_notes" />
        )}
        {activeTab === "reviews" && (
          <ReviewsTab isAdmin={isAdmin} />
        )}
        {activeTab === "tokens" && currentUserId && (
          <TokensTab currentUserId={currentUserId} isAdmin={isAdmin} />
        )}
        {activeTab === "change_password" && (
          <PortalChangePasswordTab />
        )}
      </main>
    </div>
  );
}
