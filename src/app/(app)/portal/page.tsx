"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, PaymentAccountDetails } from "@/types/database";

// ─── Types ───────────────────────────────────────────────────

type PortalTab = "profile" | "onboarding" | "sops" | "coaching" | "jobs";

interface VaResource {
  id: string;
  type: string;
  title: string;
  content: string | null;
  url: string | null;
  sort_order: number;
  created_at: string;
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
];

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

  // Payment accounts
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

// ─── Main Portal Page ────────────────────────────────────────

export default function VaPortalPage() {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<PortalTab>("profile");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
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

  const tabLabel: Record<PortalTab, string> = {
    profile: "My Profile",
    onboarding: "Start Here",
    sops: "SOPs",
    coaching: "Coaching",
    jobs: "Job Postings",
  };

  const tabSubtitle: Record<PortalTab, string> = {
    profile: "Edit your personal info and payment details",
    onboarding: "Everything you need to get started",
    sops: "Standard operating procedures for your role",
    coaching: "Resources to help you succeed",
    jobs: "Open positions and opportunities",
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
            <p className="text-[11px] font-bold text-stone tracking-widest uppercase">VA Portal</p>
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
      </main>
    </div>
  );
}
