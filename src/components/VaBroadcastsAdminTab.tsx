"use client";

import { useEffect, useState, useCallback } from "react";

type BroadcastCategory = "memo" | "training" | "coaching_notes";

interface BroadcastRecipient {
  type: string;
  value: string;
}

interface Broadcast {
  id: string;
  title: string;
  body: string;
  category: BroadcastCategory;
  magic_word: string | null;
  require_word: boolean;
  status: "draft" | "published" | "archived" | "scheduled";
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  read_count: number;
  recipients: BroadcastRecipient[];
}

interface Profile {
  id: string;
  full_name: string | null;
  role: string;
}

const STATIC_RECIPIENT_OPTIONS = [
  { label: "Everyone", type: "all", value: "all" },
  { label: "All VAs", type: "role", value: "va" },
  { label: "Admins only", type: "role", value: "admin" },
  { label: "Hourly", type: "employment_type", value: "hourly" },
  { label: "Part-time", type: "employment_type", value: "part-time" },
  { label: "Full-time", type: "employment_type", value: "full-time" },
];

const CATEGORY_OPTIONS: { label: string; value: BroadcastCategory }[] = [
  { label: "Memo", value: "memo" },
  { label: "Training", value: "training" },
  { label: "Coaching Notes", value: "coaching_notes" },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function CategoryBadge({ category }: { category: BroadcastCategory }) {
  const styles: Record<BroadcastCategory, string> = {
    memo: "bg-sage-soft text-sage",
    training: "bg-slate-blue-soft text-slate-blue",
    coaching_notes: "bg-slate-blue-soft text-slate-blue",
  };
  const labels: Record<BroadcastCategory, string> = {
    memo: "Memo",
    training: "Training",
    coaching_notes: "Coaching Notes",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles[category]}`}>
      {labels[category]}
    </span>
  );
}

function StatusBadge({ status }: { status: Broadcast["status"] }) {
  const styles: Record<Broadcast["status"], string> = {
    published: "bg-sage-soft text-sage",
    draft: "bg-amber-50 text-amber-700",
    archived: "bg-stone/10 text-stone",
    scheduled: "bg-slate-blue-soft text-slate-blue",
  };
  const labels: Record<Broadcast["status"], string> = {
    published: "Published",
    draft: "Draft",
    archived: "Archived",
    scheduled: "Scheduled",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

export default function VaBroadcastsAdminTab() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Broadcast | null>(null);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Form state
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<BroadcastCategory>("memo");
  const [recipientKey, setRecipientKey] = useState("all|all");
  const [addMagicWord, setAddMagicWord] = useState(false);
  const [magicWord, setMagicWord] = useState("");
  const [publishMode, setPublishMode] = useState<"immediate" | "schedule">("immediate");
  const [scheduledAt, setScheduledAt] = useState("");

  const fetchBroadcasts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/broadcasts");
      const d = await res.json();
      setBroadcasts(d.broadcasts || d || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBroadcasts(); }, [fetchBroadcasts]);

  useEffect(() => {
    fetch("/api/profiles?active=true")
      .then((r) => r.json())
      .then((d) => setProfiles(d.profiles || []))
      .catch(() => {});
  }, []);

  const recipientLabel = useCallback((recipients: BroadcastRecipient[]): string => {
    if (!recipients || recipients.length === 0) return "—";
    const first = recipients[0];
    if (first.type === "all") return "Everyone";
    if (first.type === "role" && first.value === "va") return "All VAs";
    if (first.type === "role" && first.value === "admin") return "Admins only";
    if (first.type === "employment_type") {
      const etLabels: Record<string, string> = { hourly: "Hourly", "part-time": "Part-time", "full-time": "Full-time" };
      return etLabels[first.value] ?? first.value;
    }
    if (first.type === "individual") {
      const p = profiles.find((x) => x.id === first.value);
      return p?.full_name ?? "Individual";
    }
    return `${first.type}: ${first.value}`;
  }, [profiles]);

  const resetForm = () => {
    setTitle("");
    setBody("");
    setCategory("memo");
    setRecipientKey("all|all");
    setAddMagicWord(false);
    setMagicWord("");
    setPublishMode("immediate");
    setScheduledAt("");
    setEditing(null);
  };

  const openEdit = (b: Broadcast) => {
    setEditing(b);
    setTitle(b.title);
    setBody(b.body);
    setCategory(b.category);
    const r = b.recipients?.[0];
    setRecipientKey(r ? `${r.type}|${r.value}` : "all|all");
    setAddMagicWord(!!b.magic_word);
    setMagicWord(b.magic_word || "");
    if (b.status === "scheduled" && b.scheduled_at) {
      setPublishMode("schedule");
      // Convert ISO to datetime-local format (YYYY-MM-DDTHH:mm)
      const dt = new Date(b.scheduled_at);
      const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      setScheduledAt(local);
    } else {
      setPublishMode("immediate");
      setScheduledAt("");
    }
    setShowForm(true);
  };

  const saveButtonLabel = () => {
    if (saving) return "Saving...";
    if (editing) return "Save Changes";
    if (publishMode === "schedule") return "Schedule Broadcast";
    return "Publish Now";
  };

  const handleSave = useCallback(async () => {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    setSaveMsg(null);

    const [rType, rValue] = recipientKey.split("|");
    const payload: Record<string, unknown> = {
      title: title.trim(),
      body: body.trim(),
      category,
      recipients: [{ type: rType, value: rValue }],
      magic_word: addMagicWord && magicWord.trim() ? magicWord.trim() : null,
      require_word: addMagicWord && magicWord.trim().length > 0,
      status: publishMode === "immediate" ? "published" : "scheduled",
      scheduled_at: publishMode === "schedule" && scheduledAt ? new Date(scheduledAt).toISOString() : null,
    };

    const res = editing
      ? await fetch(`/api/broadcasts?id=${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/broadcasts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    setSaving(false);
    if (res.ok) {
      setSaveMsg({ type: "ok", text: editing ? "Broadcast updated!" : "Broadcast created!" });
      setTimeout(() => setSaveMsg(null), 4000);
      resetForm();
      setShowForm(false);
      fetchBroadcasts();
    } else {
      const e = await res.json();
      setSaveMsg({ type: "err", text: e.error || "Failed to save" });
    }
  }, [title, body, category, recipientKey, addMagicWord, magicWord, publishMode, scheduledAt, editing, fetchBroadcasts]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Delete this broadcast? This cannot be undone.")) return;
    setDeleting((d) => ({ ...d, [id]: true }));
    await fetch(`/api/broadcasts?id=${id}`, { method: "DELETE" });
    await fetchBroadcasts();
    setDeleting((d) => ({ ...d, [id]: false }));
  }, [fetchBroadcasts]);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div />
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840]"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Broadcast
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-espresso mb-4">{editing ? "Edit Broadcast" : "New Broadcast"}</h3>
          <div className="space-y-4">

            {/* Title */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Broadcast title"
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
              />
            </div>

            {/* Body */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Message *</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                placeholder="Write your broadcast..."
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta resize-none"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as BroadcastCategory)}
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta cursor-pointer"
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Recipients */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-2 tracking-wide">Send To</label>
              <div className="flex flex-col gap-2">
                {STATIC_RECIPIENT_OPTIONS.map((o) => {
                  const key = `${o.type}|${o.value}`;
                  return (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="recipient"
                        value={key}
                        checked={recipientKey === key}
                        onChange={() => setRecipientKey(key)}
                        className="accent-terracotta"
                      />
                      <span className="text-[13px] text-walnut">{o.label}</span>
                    </label>
                  );
                })}
                {profiles.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-px bg-sand" />
                      <span className="text-[10px] font-semibold text-stone tracking-wider uppercase">Individual</span>
                      <div className="flex-1 h-px bg-sand" />
                    </div>
                    {profiles
                      .slice()
                      .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""))
                      .map((p) => {
                        const key = `individual|${p.id}`;
                        return (
                          <label key={key} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="recipient"
                              value={key}
                              checked={recipientKey === key}
                              onChange={() => setRecipientKey(key)}
                              className="accent-terracotta"
                            />
                            <span className="text-[13px] text-walnut">{p.full_name ?? p.id}</span>
                            {p.role === "admin" && (
                              <span className="text-[10px] text-stone">(admin)</span>
                            )}
                          </label>
                        );
                      })}
                  </>
                )}
              </div>
            </div>

            {/* Magic Word section */}
            <div className="rounded-lg border border-sand bg-parchment p-4 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={addMagicWord}
                  onChange={(e) => setAddMagicWord(e.target.checked)}
                  className="accent-terracotta"
                />
                <span className="text-[13px] font-semibold text-walnut">Add magic word</span>
              </label>
              {addMagicWord && (
                <div className="pl-5">
                  <input
                    type="text"
                    value={magicWord}
                    onChange={(e) => setMagicWord(e.target.value)}
                    placeholder="Enter magic word..."
                    className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                  />
                  <p className="mt-1 text-[11px] text-stone">The magic word will be hidden in the message. VA must enter it to acknowledge.</p>
                </div>
              )}
            </div>

            {/* Publish options */}
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-2 tracking-wide">Publish</label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="publishMode"
                    value="immediate"
                    checked={publishMode === "immediate"}
                    onChange={() => setPublishMode("immediate")}
                    className="accent-terracotta"
                  />
                  <span className="text-[13px] text-walnut">Immediately</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="publishMode"
                    value="schedule"
                    checked={publishMode === "schedule"}
                    onChange={() => setPublishMode("schedule")}
                    className="accent-terracotta"
                  />
                  <span className="text-[13px] text-walnut">Schedule</span>
                </label>
              </div>
              {publishMode === "schedule" && (
                <div className="mt-3 pl-5">
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                  />
                </div>
              )}
            </div>

          </div>

          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={handleSave}
              disabled={saving || !title.trim() || !body.trim()}
              className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saveButtonLabel()}
            </button>
            <button
              onClick={() => { resetForm(); setShowForm(false); }}
              className="text-xs text-stone hover:text-espresso cursor-pointer"
            >
              Cancel
            </button>
            {saveMsg && (
              <p className={`text-xs font-medium ${saveMsg.type === "ok" ? "text-sage" : "text-red-500"}`}>
                {saveMsg.text}
              </p>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-stone">
          <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
          Loading...
        </div>
      )}

      {!loading && broadcasts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-espresso">No broadcasts yet</p>
          <p className="mt-1 text-xs text-stone">Click &quot;New Broadcast&quot; to send your first broadcast.</p>
        </div>
      )}

      {!loading && broadcasts.length > 0 && (
        <div className="space-y-4">
          {broadcasts.map((b) => (
            <div key={b.id} className="rounded-xl border border-sand bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-espresso">{b.title}</h3>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className="text-[11px] text-stone">{fmtDate(b.created_at)}</span>
                    <CategoryBadge category={b.category} />
                    <StatusBadge status={b.status} />
                    {b.status === "scheduled" && b.scheduled_at && (
                      <span className="text-[11px] text-stone">Sends {new Date(b.scheduled_at).toLocaleString()}</span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-full bg-sage-soft px-2 py-0.5 text-[11px] font-medium text-sage">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {b.read_count ?? 0} acknowledged
                    </span>
                    {b.magic_word && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-terracotta-soft px-2 py-0.5 text-[11px] font-medium text-terracotta">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        Magic word
                      </span>
                    )}
                    <span className="text-[11px] text-stone">{recipientLabel(b.recipients)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(b)}
                    className="text-[11px] text-walnut hover:text-espresso cursor-pointer px-2 py-1 rounded border border-sand hover:border-walnut transition-all"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(b.id)}
                    disabled={!!deleting[b.id]}
                    className="text-[11px] text-terracotta hover:text-red-600 cursor-pointer px-2 py-1 rounded border border-sand hover:border-terracotta transition-all disabled:opacity-50"
                  >
                    {deleting[b.id] ? "..." : "Delete"}
                  </button>
                </div>
              </div>

              <div className={`text-xs text-bark leading-relaxed whitespace-pre-wrap ${!expanded[b.id] && b.body.length > 200 ? "line-clamp-3" : ""}`}>
                {b.body}
              </div>
              {b.body.length > 200 && (
                <button
                  onClick={() => setExpanded((e) => ({ ...e, [b.id]: !e[b.id] }))}
                  className="mt-1 text-[11px] text-terracotta hover:underline cursor-pointer"
                >
                  {expanded[b.id] ? "Show less" : "Read more"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
