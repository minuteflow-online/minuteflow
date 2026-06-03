"use client";

import { useEffect, useState, useCallback } from "react";

interface VaMemo {
  id: number;
  title: string;
  body: string;
  requires_confirmation: boolean;
  created_at: string;
  read_count?: number;
  read_by_me: boolean;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function VaMemosAdminTab() {
  const [memos, setMemos] = useState<VaMemo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<VaMemo | null>(null);
  const [deleting, setDeleting] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [requiresConfirmation, setRequiresConfirmation] = useState(true);

  const fetchMemos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/va-memos");
      const d = await res.json();
      setMemos(d.memos || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMemos(); }, [fetchMemos]);

  const resetForm = () => {
    setTitle(""); setBody(""); setRequiresConfirmation(true); setEditing(null);
  };

  const openEdit = (m: VaMemo) => {
    setEditing(m);
    setTitle(m.title);
    setBody(m.body);
    setRequiresConfirmation(m.requires_confirmation);
    setShowForm(true);
  };

  const handleSave = useCallback(async () => {
    if (!title.trim() || !body.trim()) return;
    setSaving(true); setSaveMsg(null);

    const payload = { title: title.trim(), body: body.trim(), requires_confirmation: requiresConfirmation };
    const res = editing
      ? await fetch(`/api/va-memos?id=${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch("/api/va-memos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

    setSaving(false);
    if (res.ok) {
      setSaveMsg({ type: "ok", text: editing ? "Memo updated!" : "Memo created and email sent to all VAs!" });
      setTimeout(() => setSaveMsg(null), 4000);
      resetForm(); setShowForm(false);
      fetchMemos();
    } else {
      const e = await res.json();
      setSaveMsg({ type: "err", text: e.error || "Failed to save" });
    }
  }, [title, body, requiresConfirmation, editing, fetchMemos]);

  const handleDelete = useCallback(async (id: number) => {
    if (!confirm("Delete this memo? This cannot be undone.")) return;
    setDeleting((d) => ({ ...d, [id]: true }));
    await fetch(`/api/va-memos?id=${id}`, { method: "DELETE" });
    await fetchMemos();
    setDeleting((d) => ({ ...d, [id]: false }));
  }, [fetchMemos]);

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
          New Memo
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-espresso mb-4">{editing ? "Edit Memo" : "New Memo"}</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Title *</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Memo title"
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Message *</label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Write your memo..."
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta resize-none" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={requiresConfirmation} onChange={(e) => setRequiresConfirmation(e.target.checked)} className="accent-terracotta" />
              <span className="text-[13px] text-walnut">Require read confirmation from VAs</span>
            </label>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={handleSave} disabled={saving || !title.trim() || !body.trim()}
              className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? "Saving..." : editing ? "Save Changes" : "Send Memo"}
            </button>
            <button onClick={() => { resetForm(); setShowForm(false); }} className="text-xs text-stone hover:text-espresso cursor-pointer">Cancel</button>
            {saveMsg && <p className={`text-xs font-medium ${saveMsg.type === "ok" ? "text-sage" : "text-red-500"}`}>{saveMsg.text}</p>}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-stone">
          <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />Loading...
        </div>
      )}

      {!loading && memos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-espresso">No memos yet</p>
          <p className="mt-1 text-xs text-stone">Click &quot;New Memo&quot; to send your first team memo.</p>
        </div>
      )}

      {!loading && memos.length > 0 && (
        <div className="space-y-4">
          {memos.map((m) => (
            <div key={m.id} className="rounded-xl border border-sand bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-espresso">{m.title}</h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[11px] text-stone">{fmtDate(m.created_at)}</span>
                    {m.requires_confirmation && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sage-soft px-2 py-0.5 text-[11px] font-medium text-sage">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                        {m.read_count ?? 0} confirmed
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => openEdit(m)} className="text-[11px] text-walnut hover:text-espresso cursor-pointer px-2 py-1 rounded border border-sand hover:border-walnut transition-all">Edit</button>
                  <button onClick={() => handleDelete(m.id)} disabled={!!deleting[m.id]} className="text-[11px] text-terracotta hover:text-red-600 cursor-pointer px-2 py-1 rounded border border-sand hover:border-terracotta transition-all disabled:opacity-50">
                    {deleting[m.id] ? "..." : "Delete"}
                  </button>
                </div>
              </div>

              <div className={`text-xs text-bark leading-relaxed whitespace-pre-wrap ${!expanded[m.id] && m.body.length > 200 ? "line-clamp-3" : ""}`}>
                {m.body}
              </div>
              {m.body.length > 200 && (
                <button onClick={() => setExpanded((e) => ({ ...e, [m.id]: !e[m.id] }))} className="mt-1 text-[11px] text-terracotta hover:underline cursor-pointer">
                  {expanded[m.id] ? "Show less" : "Read more"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
