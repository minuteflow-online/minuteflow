"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PaymentAccountDetails } from "@/types/database";

// ── Types ──────────────────────────────────────────────────────────────────

type ExtendedProfile = {
  id: string;
  full_name: string;
  username: string;
  department: string | null;
  position: string | null;
  phone: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  birthday: string | null;
  date_started: string | null;
  payment_accounts: PaymentAccountDetails | null;
};

type ProfileMilestone = {
  id: string;
  user_id: string;
  title: string;
  milestone_date: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type ProfileNote = {
  id: string;
  user_id: string;
  author_id: string;
  author_name: string;
  content: string;
  visibility: "va_only" | "admin_only" | "everyone";
  created_at: string;
};

type ProfileLink = {
  id: string;
  user_id: string;
  label: string;
  url: string;
  sort_order: number;
  created_at: string;
};

type ProfileFile = {
  id: string;
  user_id: string;
  file_type: "resume" | "general";
  filename: string;
  drive_file_id: string;
  created_at: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(isoDate: string | null): string {
  if (!isoDate) return "—";
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function TeamProfilePanel({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const supabase = createClient();
  const [profile, setProfile] = useState<ExtendedProfile | null>(null);
  const [milestones, setMilestones] = useState<ProfileMilestone[]>([]);
  const [notes, setNotes] = useState<ProfileNote[]>([]);
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const [files, setFiles] = useState<ProfileFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    const [authRes, profileRes, milestonesRes, notesRes, linksRes, filesRes] = await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from("profiles")
        .select("id,full_name,username,department,position,phone,address,emergency_contact_name,emergency_contact_phone,birthday,date_started,payment_accounts")
        .eq("id", userId)
        .single(),
      supabase.from("profile_milestones").select("*").eq("user_id", userId).order("milestone_date", { ascending: false }),
      supabase.from("profile_notes").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from("profile_links").select("*").eq("user_id", userId).order("sort_order"),
      supabase.from("profile_files").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    ]);

    if (authRes.data.user) {
      const { data: cp } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", authRes.data.user.id)
        .single();
      setCurrentUser({ id: authRes.data.user.id, name: (cp as { full_name?: string } | null)?.full_name || "Unknown" });
    }

    setProfile((profileRes.data as ExtendedProfile | null) ?? null);
    setMilestones((milestonesRes.data || []) as ProfileMilestone[]);
    setNotes((notesRes.data || []) as ProfileNote[]);
    setLinks((linksRes.data || []) as ProfileLink[]);
    setFiles((filesRes.data || []) as ProfileFile[]);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="px-6 py-8 text-[13px] text-stone">Loading profile…</div>;
  }

  return (
    <div className="px-6 py-5 space-y-5">
      <BasicInfoSection
        profile={profile}
        userId={userId}
        isAdmin={isAdmin}
        onRefresh={load}
      />
      <PersonalInfoSection
        profile={profile}
        userId={userId}
        isAdmin={isAdmin}
        onRefresh={load}
      />
      <PaymentInfoSection
        profile={profile}
        userId={userId}
        isAdmin={isAdmin}
        onRefresh={load}
      />
      <MilestonesSection
        milestones={milestones}
        userId={userId}
        isAdmin={isAdmin}
        onRefresh={load}
      />
      <NotesSection
        notes={notes}
        userId={userId}
        isAdmin={isAdmin}
        currentUser={currentUser}
        onRefresh={load}
      />
      <LinksSection
        links={links}
        userId={userId}
        isAdmin={isAdmin}
        onRefresh={load}
      />
      <FilesSection
        files={files}
        userId={userId}
        isAdmin={isAdmin}
        onRefresh={load}
      />
    </div>
  );
}

// ── Basic Info Section ─────────────────────────────────────────────────────

function BasicInfoSection({
  profile,
  userId,
  isAdmin,
  onRefresh,
}: {
  profile: ExtendedProfile | null;
  userId: string;
  isAdmin: boolean;
  onRefresh: () => void;
}) {
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: profile?.full_name || "",
    username: profile?.username || "",
    department: profile?.department || "",
    position: profile?.position || "",
  });

  useEffect(() => {
    setForm({
      full_name: profile?.full_name || "",
      username: profile?.username || "",
      department: profile?.department || "",
      position: profile?.position || "",
    });
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    await supabase
      .from("profiles")
      .update({
        full_name: form.full_name.trim(),
        username: form.username.trim(),
        department: form.department.trim() || null,
        position: form.position.trim() || null,
      })
      .eq("id", userId);
    setSaving(false);
    setEditing(false);
    onRefresh();
  };

  const fields: { label: string; key: keyof typeof form }[] = [
    { label: "Full Name", key: "full_name" },
    { label: "Username", key: "username" },
    { label: "Department", key: "department" },
    { label: "Position", key: "position" },
  ];

  return (
    <div className="rounded-xl border border-sand bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-bold text-espresso uppercase tracking-wide">Basic Information</h3>
        {isAdmin && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map(({ label, key }) => (
              <div key={key}>
                <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">{label}</p>
                <input
                  type="text"
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {fields.map(({ label, key }) => (
            <div key={key}>
              <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">{label}</p>
              <p className="text-[13px] text-espresso mt-0.5">{form[key] || "—"}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Personal Info Section ──────────────────────────────────────────────────

function PersonalInfoSection({
  profile,
  userId,
  isAdmin,
  onRefresh,
}: {
  profile: ExtendedProfile | null;
  userId: string;
  isAdmin: boolean;
  onRefresh: () => void;
}) {
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    phone: profile?.phone || "",
    address: profile?.address || "",
    emergency_contact_name: profile?.emergency_contact_name || "",
    emergency_contact_phone: profile?.emergency_contact_phone || "",
    birthday: profile?.birthday || "",
    date_started: profile?.date_started || "",
  });

  useEffect(() => {
    setForm({
      phone: profile?.phone || "",
      address: profile?.address || "",
      emergency_contact_name: profile?.emergency_contact_name || "",
      emergency_contact_phone: profile?.emergency_contact_phone || "",
      birthday: profile?.birthday || "",
      date_started: profile?.date_started || "",
    });
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    await supabase.from("profiles").update({
      phone: form.phone || null,
      address: form.address || null,
      emergency_contact_name: form.emergency_contact_name || null,
      emergency_contact_phone: form.emergency_contact_phone || null,
      birthday: form.birthday || null,
      date_started: form.date_started || null,
    }).eq("id", userId);
    setSaving(false);
    setEditing(false);
    onRefresh();
  };

  const fields: { label: string; key: keyof typeof form; type?: string }[] = [
    { label: "Phone", key: "phone" },
    { label: "Address", key: "address" },
    { label: "Emergency Contact", key: "emergency_contact_name" },
    { label: "Emergency Phone", key: "emergency_contact_phone" },
    { label: "Birthday", key: "birthday", type: "date" },
    { label: "Date Started", key: "date_started", type: "date" },
  ];

  return (
    <div className="rounded-xl border border-sand bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-bold text-espresso uppercase tracking-wide">Personal Info</h3>
        {isAdmin && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map(({ label, key, type }) => (
              <div key={key}>
                <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">{label}</p>
                <input
                  type={type || "text"}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {fields.map(({ label, key, type }) => (
            <div key={key}>
              <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">{label}</p>
              <p className="text-[13px] text-espresso mt-0.5">
                {type === "date" ? formatDate(profile?.[key] || null) : (profile?.[key] || "—")}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Payment Info Section ───────────────────────────────────────────────────

function PaymentInfoSection({
  profile,
  userId,
  isAdmin,
  onRefresh,
}: {
  profile: ExtendedProfile | null;
  userId: string;
  isAdmin: boolean;
  onRefresh: () => void;
}) {
  const supabase = createClient();
  const pa = profile?.payment_accounts || {};
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gcashNumber, setGcashNumber] = useState(pa.gcash?.number || "");
  const [gcashName, setGcashName] = useState(pa.gcash?.name || "");
  const [bankName, setBankName] = useState(pa.bank_transfer?.bank || pa.bank_deposit?.bank || "");
  const [bankAccount, setBankAccount] = useState(pa.bank_transfer?.account || pa.bank_deposit?.account || "");
  const [bankHolder, setBankHolder] = useState(pa.bank_transfer?.name || pa.bank_deposit?.name || "");
  const [paypalEmail, setPaypalEmail] = useState(pa.paypal?.email || "");

  useEffect(() => {
    const p = profile?.payment_accounts || {};
    setGcashNumber(p.gcash?.number || "");
    setGcashName(p.gcash?.name || "");
    setBankName(p.bank_transfer?.bank || p.bank_deposit?.bank || "");
    setBankAccount(p.bank_transfer?.account || p.bank_deposit?.account || "");
    setBankHolder(p.bank_transfer?.name || p.bank_deposit?.name || "");
    setPaypalEmail(p.paypal?.email || "");
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
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
    await supabase
      .from("profiles")
      .update({ payment_accounts: Object.keys(payment_accounts).length > 0 ? payment_accounts : null })
      .eq("id", userId);
    setSaving(false);
    setEditing(false);
    onRefresh();
  };

  const hasPayment = !!(pa.gcash?.number || pa.bank_transfer?.bank || pa.bank_deposit?.bank || pa.paypal?.email);

  return (
    <div className="rounded-xl border border-sand bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-bold text-espresso uppercase tracking-wide">Payment Information</h3>
        {isAdmin && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      {!editing && (
        <>
          {!hasPayment ? (
            <p className="text-[13px] text-stone">No payment info added yet.</p>
          ) : (
            <div className="space-y-3">
              {(pa.gcash?.number || pa.gcash?.name) && (
                <div>
                  <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">GCash</p>
                  <p className="text-[13px] text-espresso">{pa.gcash?.number}{pa.gcash?.name ? ` — ${pa.gcash.name}` : ""}</p>
                </div>
              )}
              {(pa.bank_transfer?.bank || pa.bank_deposit?.bank) && (
                <div>
                  <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">Bank Transfer</p>
                  <p className="text-[13px] text-espresso">
                    {pa.bank_transfer?.bank || pa.bank_deposit?.bank}
                    {(pa.bank_transfer?.account || pa.bank_deposit?.account) ? ` · ${pa.bank_transfer?.account || pa.bank_deposit?.account}` : ""}
                    {(pa.bank_transfer?.name || pa.bank_deposit?.name) ? ` · ${pa.bank_transfer?.name || pa.bank_deposit?.name}` : ""}
                  </p>
                </div>
              )}
              {pa.paypal?.email && (
                <div>
                  <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">PayPal</p>
                  <p className="text-[13px] text-espresso">{pa.paypal.email}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {editing && (
        <div className="space-y-4">
          <p className="text-[11px] text-stone">Fill in what applies to this VA.</p>

          {/* GCash */}
          <div className="pb-3 border-b border-parchment">
            <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-2">GCash</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">Number</p>
                <input
                  type="text"
                  value={gcashNumber}
                  onChange={(e) => setGcashNumber(e.target.value)}
                  placeholder="09XX XXX XXXX"
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">Registered Name</p>
                <input
                  type="text"
                  value={gcashName}
                  onChange={(e) => setGcashName(e.target.value)}
                  placeholder="Name on GCash"
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                />
              </div>
            </div>
          </div>

          {/* Bank Transfer */}
          <div className="pb-3 border-b border-parchment">
            <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-2">Bank Transfer</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">Bank</p>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="e.g. BDO, BPI"
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">Account Number</p>
                <input
                  type="text"
                  value={bankAccount}
                  onChange={(e) => setBankAccount(e.target.value)}
                  placeholder="Account number"
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">Account Holder</p>
                <input
                  type="text"
                  value={bankHolder}
                  onChange={(e) => setBankHolder(e.target.value)}
                  placeholder="Name on account"
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                />
              </div>
            </div>
          </div>

          {/* PayPal */}
          <div>
            <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-2">PayPal</p>
            <div className="max-w-xs">
              <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">Email</p>
              <input
                type="email"
                value={paypalEmail}
                onChange={(e) => setPaypalEmail(e.target.value)}
                placeholder="your@paypal.com"
                className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Milestones Section ─────────────────────────────────────────────────────

function MilestonesSection({
  milestones,
  userId,
  isAdmin,
  onRefresh,
}: {
  milestones: ProfileMilestone[];
  userId: string;
  isAdmin: boolean;
  onRefresh: () => void;
}) {
  const supabase = createClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", milestone_date: "", note: "" });

  const resetForm = () => {
    setForm({ title: "", milestone_date: "", note: "" });
    setEditingId(null);
    setShowForm(false);
  };

  const handleEdit = (m: ProfileMilestone) => {
    setEditingId(m.id);
    setForm({ title: m.title, milestone_date: m.milestone_date || "", note: m.note || "" });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this milestone?")) return;
    await supabase.from("profile_milestones").delete().eq("id", id);
    onRefresh();
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    if (editingId) {
      await supabase.from("profile_milestones").update({
        title: form.title.trim(),
        milestone_date: form.milestone_date || null,
        note: form.note.trim() || null,
        updated_at: new Date().toISOString(),
      }).eq("id", editingId);
    } else {
      await supabase.from("profile_milestones").insert({
        user_id: userId,
        title: form.title.trim(),
        milestone_date: form.milestone_date || null,
        note: form.note.trim() || null,
      });
    }
    setSaving(false);
    resetForm();
    onRefresh();
  };

  return (
    <div className="rounded-xl border border-sand bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-bold text-espresso uppercase tracking-wide">Milestones</h3>
        {isAdmin && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors"
          >
            + Add Milestone
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-4 rounded-lg border border-sand bg-parchment/30 p-3 space-y-2">
          <div>
            <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">Title *</p>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Completed onboarding"
              className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">Date</p>
              <input
                type="date"
                value={form.milestone_date}
                onChange={(e) => setForm((f) => ({ ...f, milestone_date: e.target.value }))}
                className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
              />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">Note (optional)</p>
              <input
                type="text"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Brief note"
                className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !form.title.trim()}
              className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Update" : "Add"}
            </button>
            <button onClick={resetForm} className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {milestones.length === 0 && !showForm ? (
        <p className="text-[13px] text-stone py-2">No milestones yet.</p>
      ) : milestones.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-parchment">
                <th className="text-left py-2 pr-3 text-[10px] font-semibold text-walnut uppercase tracking-wide">Title</th>
                <th className="text-left py-2 pr-3 text-[10px] font-semibold text-walnut uppercase tracking-wide">Date</th>
                <th className="text-left py-2 pr-3 text-[10px] font-semibold text-walnut uppercase tracking-wide">Note</th>
                {isAdmin && <th className="py-2 text-right text-[10px] font-semibold text-walnut uppercase tracking-wide">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {milestones.map((m) => (
                <tr key={m.id} className="border-b border-parchment/50 last:border-0">
                  <td className="py-2 pr-3 font-semibold text-espresso">{m.title}</td>
                  <td className="py-2 pr-3 text-bark">{formatDate(m.milestone_date)}</td>
                  <td className="py-2 pr-3 text-stone">{m.note || "—"}</td>
                  {isAdmin && (
                    <td className="py-2 text-right">
                      <button onClick={() => handleEdit(m)} className="text-[11px] text-walnut hover:text-sage cursor-pointer font-semibold mr-2">Edit</button>
                      <button onClick={() => handleDelete(m.id)} className="text-[11px] text-walnut hover:text-terracotta cursor-pointer font-semibold">Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

// ── Notes Section ──────────────────────────────────────────────────────────

type NoteGroup = {
  key: "va_only" | "admin_only" | "everyone";
  label: string;
  description: string;
  canAdd: (isAdmin: boolean) => boolean;
};

const NOTE_GROUPS: NoteGroup[] = [
  {
    key: "va_only",
    label: "VA Private Notes",
    description: "Written by the VA, visible to VA only",
    canAdd: () => false,
  },
  {
    key: "admin_only",
    label: "Admin Notes",
    description: "Written by admin, visible to admin only",
    canAdd: (isAdmin) => isAdmin,
  },
  {
    key: "everyone",
    label: "General Notes",
    description: "Visible to everyone",
    canAdd: () => true,
  },
];

function NotesSection({
  notes,
  userId,
  isAdmin,
  currentUser,
  onRefresh,
}: {
  notes: ProfileNote[];
  userId: string;
  isAdmin: boolean;
  currentUser: { id: string; name: string } | null;
  onRefresh: () => void;
}) {
  const supabase = createClient();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["everyone"]));
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleAdd = async (visibility: string) => {
    if (!noteContent.trim() || !currentUser) return;
    setSaving(true);
    await supabase.from("profile_notes").insert({
      user_id: userId,
      author_id: currentUser.id,
      author_name: currentUser.name,
      content: noteContent.trim(),
      visibility,
    });
    setNoteContent("");
    setAddingTo(null);
    setSaving(false);
    onRefresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this note?")) return;
    await supabase.from("profile_notes").delete().eq("id", id);
    onRefresh();
  };

  return (
    <div className="rounded-xl border border-sand bg-white p-4">
      <h3 className="text-[10px] font-bold text-espresso uppercase tracking-wide mb-3">Notes</h3>
      <div className="space-y-3">
        {NOTE_GROUPS.filter((g) => g.key !== "va_only").map((group) => {
          const groupNotes = notes.filter((n) => n.visibility === group.key);
          const isExpanded = expandedGroups.has(group.key);
          const canAdd = group.canAdd(isAdmin);

          return (
            <div key={group.key} className="rounded-lg border border-sand overflow-hidden">
              <button
                onClick={() => toggleGroup(group.key)}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-parchment/30 hover:bg-parchment/60 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-bark">{isExpanded ? "▼" : "▶"}</span>
                  <span className="text-[12px] font-semibold text-espresso">{group.label}</span>
                  <span className="text-[10px] text-stone">({groupNotes.length})</span>
                </div>
                <span className="text-[10px] text-stone italic">{group.description}</span>
              </button>

              {isExpanded && (
                <div className="p-3 space-y-2">
                  {groupNotes.length === 0 ? (
                    <p className="text-[12px] text-stone py-1">No notes yet.</p>
                  ) : (
                    groupNotes.map((note) => (
                      <div key={note.id} className="flex gap-2 rounded-lg bg-parchment/30 px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] text-espresso leading-relaxed">{note.content}</p>
                          <p className="text-[10px] text-stone mt-1">
                            {note.author_name} &middot; {formatDateTime(note.created_at)}
                          </p>
                        </div>
                        {(isAdmin || (currentUser && currentUser.id === note.author_id)) && (
                          <button
                            onClick={() => handleDelete(note.id)}
                            className="shrink-0 text-[10px] text-stone hover:text-terracotta cursor-pointer transition-colors"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))
                  )}

                  {canAdd && (
                    <div>
                      {addingTo === group.key ? (
                        <div className="space-y-2 pt-1">
                          <textarea
                            value={noteContent}
                            onChange={(e) => setNoteContent(e.target.value)}
                            placeholder="Write a note…"
                            rows={2}
                            className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white resize-none"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAdd(group.key)}
                              disabled={saving || !noteContent.trim()}
                              className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
                            >
                              {saving ? "Saving…" : "Add Note"}
                            </button>
                            <button
                              onClick={() => { setAddingTo(null); setNoteContent(""); }}
                              className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setAddingTo(group.key); setNoteContent(""); }}
                          className="mt-1 text-[11px] font-semibold text-sage hover:text-sage/70 cursor-pointer transition-colors"
                        >
                          + Add Note
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Links Section ──────────────────────────────────────────────────────────

function LinksSection({
  links,
  userId,
  isAdmin,
  onRefresh,
}: {
  links: ProfileLink[];
  userId: string;
  isAdmin: boolean;
  onRefresh: () => void;
}) {
  const supabase = createClient();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ label: "", url: "" });

  const handleAdd = async () => {
    if (!form.label.trim() || !form.url.trim()) return;
    setSaving(true);
    const url = form.url.startsWith("http") ? form.url.trim() : `https://${form.url.trim()}`;
    await supabase.from("profile_links").insert({
      user_id: userId,
      label: form.label.trim(),
      url,
      sort_order: links.length,
    });
    setForm({ label: "", url: "" });
    setShowForm(false);
    setSaving(false);
    onRefresh();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("profile_links").delete().eq("id", id);
    onRefresh();
  };

  return (
    <div className="rounded-xl border border-sand bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-bold text-espresso uppercase tracking-wide">Links</h3>
        {isAdmin && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors"
          >
            + Add Link
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-3 rounded-lg border border-sand bg-parchment/30 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">Label</p>
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. LinkedIn"
                className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
              />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">URL</p>
              <input
                type="text"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="linkedin.com/in/..."
                className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving || !form.label.trim() || !form.url.trim()}
              className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Add"}
            </button>
            <button
              onClick={() => { setShowForm(false); setForm({ label: "", url: "" }); }}
              className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {links.length === 0 && !showForm ? (
        <p className="text-[13px] text-stone py-1">No links added.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {links.map((link) => (
            <div key={link.id} className="flex items-center gap-1.5 rounded-lg border border-sand bg-parchment/30 px-3 py-1.5">
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-semibold text-slate-blue hover:text-espresso transition-colors"
              >
                {link.label} ↗
              </a>
              {isAdmin && (
                <button
                  onClick={() => handleDelete(link.id)}
                  className="text-[10px] text-stone hover:text-terracotta cursor-pointer transition-colors ml-1"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Files Section ──────────────────────────────────────────────────────────

function FilesSection({
  files,
  userId,
  isAdmin,
  onRefresh,
}: {
  files: ProfileFile[];
  userId: string;
  isAdmin: boolean;
  onRefresh: () => void;
}) {
  const supabase = createClient();
  const [uploadingResume, setUploadingResume] = useState(false);
  const [uploadingGeneral, setUploadingGeneral] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const resumeFile = files.find((f) => f.file_type === "resume");
  const generalFiles = files.filter((f) => f.file_type === "general");

  const handleUpload = async (file: File, fileType: "resume" | "general") => {
    setUploadError(null);
    if (fileType === "resume") setUploadingResume(true);
    else setUploadingGeneral(true);

    try {
      const body = new FormData();
      body.append("file", file);
      body.append("userId", userId);
      body.append("fileType", fileType);
      body.append("filename", file.name);

      const res = await fetch("/api/profile-files", { method: "POST", body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err?.error || "Upload failed");
      }
      onRefresh();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingResume(false);
      setUploadingGeneral(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this file?")) return;
    await supabase.from("profile_files").delete().eq("id", id);
    onRefresh();
  };

  return (
    <div className="rounded-xl border border-sand bg-white p-4">
      <h3 className="text-[10px] font-bold text-espresso uppercase tracking-wide mb-3">Files</h3>

      {uploadError && (
        <div className="mb-3 rounded-lg bg-terracotta-soft border border-terracotta/20 px-3 py-2 text-[12px] text-terracotta">
          {uploadError}
        </div>
      )}

      {/* Resume */}
      <div className="mb-4">
        <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-2">Resume</p>
        {resumeFile ? (
          <div className="flex items-center gap-3 rounded-lg border border-sand bg-parchment/30 px-3 py-2.5">
            <span className="text-[12px] font-semibold text-espresso flex-1 truncate">{resumeFile.filename}</span>
            <a
              href={`https://drive.google.com/file/d/${resumeFile.drive_file_id}/view`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-semibold text-slate-blue hover:text-espresso transition-colors"
            >
              View ↗
            </a>
            <span className="text-[10px] text-stone">{formatDateTime(resumeFile.created_at)}</span>
            {isAdmin && (
              <button onClick={() => handleDelete(resumeFile.id)} className="text-[10px] text-stone hover:text-terracotta cursor-pointer">✕</button>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-stone mb-2">No resume uploaded.</p>
        )}
        {isAdmin && (
          <label className="mt-2 inline-flex items-center gap-1.5 cursor-pointer px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors">
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              disabled={uploadingResume}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f, "resume");
                e.target.value = "";
              }}
            />
            {uploadingResume ? "Uploading…" : resumeFile ? "Replace Resume" : "Upload Resume (PDF)"}
          </label>
        )}
      </div>

      {/* General Files */}
      <div>
        <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-2">General Files</p>
        {generalFiles.length === 0 ? (
          <p className="text-[12px] text-stone mb-2">No files uploaded.</p>
        ) : (
          <div className="space-y-1.5 mb-2">
            {generalFiles.map((f) => (
              <div key={f.id} className="flex items-center gap-3 rounded-lg border border-sand bg-parchment/30 px-3 py-2">
                <span className="text-[12px] font-semibold text-espresso flex-1 truncate">{f.filename}</span>
                <a
                  href={`https://drive.google.com/file/d/${f.drive_file_id}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-semibold text-slate-blue hover:text-espresso transition-colors"
                >
                  View ↗
                </a>
                <span className="text-[10px] text-stone">{formatDateTime(f.created_at)}</span>
                {isAdmin && (
                  <button onClick={() => handleDelete(f.id)} className="text-[10px] text-stone hover:text-terracotta cursor-pointer">✕</button>
                )}
              </div>
            ))}
          </div>
        )}
        {isAdmin && (
          <label className="inline-flex items-center gap-1.5 cursor-pointer px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors">
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              disabled={uploadingGeneral}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f, "general");
                e.target.value = "";
              }}
            />
            {uploadingGeneral ? "Uploading…" : "Upload PDF"}
          </label>
        )}
      </div>
    </div>
  );
}
