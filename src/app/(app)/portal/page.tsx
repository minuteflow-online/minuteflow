"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, PaymentAccountDetails } from "@/types/database";

// ─── Types ───────────────────────────────────────────────────

type PortalTab = "profile" | "onboarding" | "sops" | "coaching" | "jobs" | "requests";

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
    id: "coaching",
    label: "Coaching",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
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

// ─── Profile Tab ─────────────────────────────────────────────

function ProfileTab({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const supabase = createClient();
  const [fullName, setFullName] = useState(profile.full_name || "");
  const [username, setUsername] = useState(profile.username || "");
  const [department, setDepartment] = useState(profile.department || "");
  const [position, setPosition] = useState(profile.position || "");

  const pa = profile.payment_accounts || {};
  const [gcashNumber, setGcashNumber] = useState(pa.gcash?.number || "");
  const [gcashName, setGcashName] = useState(pa.gcash?.name || "");
  const [bankName, setBankName] = useState(pa.bank_transfer?.bank || pa.bank_deposit?.bank || "");
  const [bankAccount, setBankAccount] = useState(pa.bank_transfer?.account || pa.bank_deposit?.account || "");
  const [bankHolder, setBankHolder] = useState(pa.bank_transfer?.name || pa.bank_deposit?.name || "");
  const [paypalEmail, setPaypalEmail] = useState(pa.paypal?.email || "");

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);

    const payment_accounts: PaymentAccountDetails = {};
    if (gcashNumber || gcashName) {
      payment_accounts.gcash = { number: gcashNumber || undefined, name: gcashName || undefined };
    }
    if (bankName || bankAccount || bankHolder) {
      payment_accounts.bank_transfer = {
        bank: bankName || undefined,
        account: bankAccount || undefined,
        name: bankHolder || undefined,
      };
    }
    if (paypalEmail) {
      payment_accounts.paypal = { email: paypalEmail };
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        username: username.trim(),
        department: department.trim() || null,
        position: position.trim() || null,
        payment_accounts: Object.keys(payment_accounts).length > 0 ? payment_accounts : null,
      })
      .eq("id", profile.id)
      .select()
      .single();

    setSaving(false);

    if (error) {
      setSaveMsg({ type: "err", text: error.message });
      return;
    }
    if (data) {
      onSaved(data as Profile);
      setSaveMsg({ type: "ok", text: "Profile saved!" });
      setTimeout(() => setSaveMsg(null), 3000);
    }
  }, [supabase, profile.id, fullName, username, department, position, gcashNumber, gcashName, bankName, bankAccount, bankHolder, paypalEmail, onSaved]);

  return (
    <div className="max-w-2xl space-y-6">
      {/* Basic Info */}
      <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-bold text-espresso">Basic Information</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full py-2.5 px-3.5 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full py-2.5 px-3.5 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Department</label>
            <input
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. Virtual Assistance"
              className="w-full py-2.5 px-3.5 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] placeholder:text-stone"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Position</label>
            <input
              type="text"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="e.g. Full-time VA"
              className="w-full py-2.5 px-3.5 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] placeholder:text-stone"
            />
          </div>
        </div>
      </div>

      {/* Payment Info */}
      <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-bold text-espresso">Payment Information</h3>
        <p className="mb-4 text-xs text-stone">This is how you&apos;ll receive your payments. Fill in what applies.</p>

        {/* GCash */}
        <div className="mb-4 pb-4 border-b border-parchment">
          <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">GCash</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] text-bark mb-1">Number</label>
              <input
                type="text"
                value={gcashNumber}
                onChange={(e) => setGcashNumber(e.target.value)}
                placeholder="09XX XXX XXXX"
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
              />
            </div>
            <div>
              <label className="block text-[11px] text-bark mb-1">Registered Name</label>
              <input
                type="text"
                value={gcashName}
                onChange={(e) => setGcashName(e.target.value)}
                placeholder="Name on GCash"
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
              />
            </div>
          </div>
        </div>

        {/* Bank Transfer */}
        <div className="mb-4 pb-4 border-b border-parchment">
          <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">Bank Transfer</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-[11px] text-bark mb-1">Bank</label>
              <input
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="e.g. BDO, BPI"
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
              />
            </div>
            <div>
              <label className="block text-[11px] text-bark mb-1">Account Number</label>
              <input
                type="text"
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value)}
                placeholder="Account number"
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
              />
            </div>
            <div>
              <label className="block text-[11px] text-bark mb-1">Account Holder</label>
              <input
                type="text"
                value={bankHolder}
                onChange={(e) => setBankHolder(e.target.value)}
                placeholder="Name on account"
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
              />
            </div>
          </div>
        </div>

        {/* PayPal */}
        <div>
          <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">PayPal</p>
          <div className="max-w-sm">
            <label className="block text-[11px] text-bark mb-1">PayPal Email</label>
            <input
              type="email"
              value={paypalEmail}
              onChange={(e) => setPaypalEmail(e.target.value)}
              placeholder="your@paypal.com"
              className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
            />
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save Profile"}
        </button>
        {saveMsg && (
          <p className={`text-xs font-medium ${saveMsg.type === "ok" ? "text-sage" : "text-red-500"}`}>
            {saveMsg.text}
          </p>
        )}
      </div>
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
    coaching: "Coaching",
    jobs: "Job Postings",
    requests: "Requests",
  };

  const tabSubtitle: Record<PortalTab, string> = {
    profile: "Edit your personal info and payment details",
    onboarding: "Everything you need to get started",
    sops: "Standard operating procedures for your role",
    coaching: "Resources to help you succeed",
    jobs: "Open positions and opportunities",
    requests: isAdmin
      ? "Review and respond to team requests"
      : "Submit and track your requests",
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
          <ProfileTab profile={profile} onSaved={setProfile} />
        )}
        {activeTab === "onboarding" && (
          <ResourcesTab type="onboarding" label="Onboarding" emptyLabel="onboarding materials" />
        )}
        {activeTab === "sops" && (
          <ResourcesTab type="sop" label="SOPs" emptyLabel="SOPs" />
        )}
        {activeTab === "coaching" && (
          <ResourcesTab type="coaching" label="Coaching" emptyLabel="coaching resources" />
        )}
        {activeTab === "jobs" && (
          <ResourcesTab type="job_posting" label="Job Postings" emptyLabel="job postings" />
        )}
        {activeTab === "requests" && currentUserId && (
          <RequestsTab currentUserId={currentUserId} isAdmin={isAdmin} />
        )}
      </main>
    </div>
  );
}
