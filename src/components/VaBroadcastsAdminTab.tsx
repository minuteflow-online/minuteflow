"use client";

import { useEffect, useState, useCallback } from "react";

interface BroadcastRecipient {
  type: string;
  value: string;
}

interface Broadcast {
  id: string;
  title: string;
  body: string;
  category: "memo" | "training" | "announcement";
  magic_word: string | null;
  require_word: boolean;
  status: "draft" | "published" | "archived";
  created_at: string;
  updated_at: string;
  read_count: number;
  recipients: BroadcastRecipient[];
}

const RECIPIENT_OPTIONS = [
  { label: "Everyone", type: "all", value: "all" },
  { label: "All VAs", type: "role", value: "va" },
];

const CATEGORY_OPTIONS: { label: string; value: Broadcast["category"] }[] = [
  { label: "Memo", value: "memo" },
  { label: "Training", value: "training" },
  { label: "Announcement", value: "announcement" },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function recipientLabel(recipients: BroadcastRecipient[]): string {
  if (!recipients || recipients.length === 0) return "—";
  const first = recipients[0];
  if (first.type === "all") return "Everyone";
  if (first.type === "role" && first.value === "va") return "All VAs";
  return `${first.type}: ${first.value}`;
}

function CategoryBadge({ category }: { category: Broadcast["category"] }) {
  const styles: Record<Broadcast["category"], string> = {
    memo: "bg-sage-soft text-sage",
    training: "bg-slate-blue-soft text-slate-blue",
    announcement: "bg-terracotta-soft text-terracotta",
  };
  const labels: Record<Broadcast["category"], string> = {
    memo: "Memo",
    training: "Training",
    announcement: "Announcement",
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
  };
  const labels: Record<Broadcast["status"], string> = {
    published: "Published",
    draft: "Draft",
    archived: "Archived",
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
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Broadcast | null>(null);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Form state
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<Broadcast["category"]>("memo");
  const [recipientKey, setRecipientKey] = useState("all|all");
  const [addMagicWord, setAddMagicWord] = useState(false);
  const [magicWord, setMagicWord] = useState("");
  const [requireWord, setRequireWord] = useState(false);
  const [publishImmediately, setPublishImmediately] = useState(true);

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

  const resetForm = () => {
    setTitle("");
    setBody("");
    setCategory("memo");
    setRecipientKey("all|all");
    setAddMagicWord(false);
    setMagicWord("");
    setRequireWord(false);
    setPublishImmediately(true);
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
    setRequireWord(b.require_word);
    setPublishImmediately(b.status === "published");
    setShowForm(true);
  };

  const handleSave = useCallback(async () => {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    setSaveMsg(null);

    const [rType, rValue] = recipientKey.split("|");
    const payload = {
      title: title.trim(),
      body: body.trim(),
      category,
      recipients: [{ type: rType, value: rValue }],
      magic_word: addMagicWord && magicWord.trim() ? magicWord.trim() : null,
      require_word: addMagicWord ? requireWord : false,
      status: publishImmediately ? "published" : "draft",
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
  }, [title, body, category, recipientKey, addMagicWord, magicWord, requireWord, publishImmediately, editing, fetchBroadcasts]);

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
                onChange={(e) => setCategory(e.target.value as Broadcast["category"])}
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
                {RECIPIENT_OPTIONS.map((o) => {
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
                <div className="space-y-3 pl-5">
                  <div>
                    <input
                      type="text"
                      value={magicWord}
                      onChange={(e) => setMagicWord(e.target.value)}
                      placeholder="Enter magic word..."
                      className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                    />
                    <p className="mt-1 text-[11px] text-stone">The magic word will be automatically inserted into the message body.</p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requireWord}
                      onChange={(e) => setRequireWord(e.target.checked)}
                      className="accent-terracotta"
                    />
                    <span className="text-[13px] text-walnut">Require magic word to acknowledge</span>
                  </label>
                </div>
              )}
            </div>

            {/* Status */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={publishImmediately}
                onChange={(e) => setPublishImmediately(e.target.checked)}
                className="accent-terracotta"
              />
              <span className="text-[13px] text-walnut">Publish immediately</span>
              {!publishImmediately && (
                <span className="text-[11px] text-stone ml-1">(will be saved as draft)</span>
              )}
            </label>

          </div>

          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={handleSave}
              disabled={saving || !title.trim() || !body.trim()}
              className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : editing ? "Save Changes" : publishImmediately ? "Publish Broadcast" : "Save Draft"}
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
