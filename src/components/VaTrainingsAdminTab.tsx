"use client";

import { useEffect, useState, useCallback } from "react";

interface VaTraining {
  id: number;
  title: string;
  description: string | null;
  url: string | null;
  category: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export default function VaTrainingsAdminTab() {
  const [trainings, setTrainings] = useState<VaTraining[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<VaTraining | null>(null);
  const [deleting, setDeleting] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Form fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("general");
  const [notify, setNotify] = useState(true);

  const fetchTrainings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/va-trainings");
      const d = await res.json();
      setTrainings(d.trainings || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTrainings(); }, [fetchTrainings]);

  const resetForm = () => {
    setTitle(""); setDescription(""); setUrl(""); setCategory("general"); setNotify(true); setEditing(null);
  };

  const openEdit = (t: VaTraining) => {
    setEditing(t);
    setTitle(t.title);
    setDescription(t.description || "");
    setUrl(t.url || "");
    setCategory(t.category);
    setNotify(false);
    setShowForm(true);
  };

  const handleSave = useCallback(async () => {
    if (!title.trim()) return;
    setSaving(true); setSaveMsg(null);

    const body = { title: title.trim(), description: description.trim() || null, url: url.trim() || null, category, notify };
    const res = editing
      ? await fetch(`/api/va-trainings?id=${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/va-trainings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    setSaving(false);
    if (res.ok) {
      setSaveMsg({ type: "ok", text: editing ? "Training updated!" : notify ? "Training created and email sent!" : "Training created!" });
      setTimeout(() => setSaveMsg(null), 3000);
      resetForm(); setShowForm(false);
      fetchTrainings();
    } else {
      const e = await res.json();
      setSaveMsg({ type: "err", text: e.error || "Failed to save" });
    }
  }, [title, description, url, category, notify, editing, fetchTrainings]);

  const handleDelete = useCallback(async (id: number) => {
    if (!confirm("Delete this training?")) return;
    setDeleting((d) => ({ ...d, [id]: true }));
    await fetch(`/api/va-trainings?id=${id}`, { method: "DELETE" });
    await fetchTrainings();
    setDeleting((d) => ({ ...d, [id]: false }));
  }, [fetchTrainings]);

  const handleToggleActive = useCallback(async (t: VaTraining) => {
    await fetch(`/api/va-trainings?id=${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !t.is_active }),
    });
    fetchTrainings();
  }, [fetchTrainings]);

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div />
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840]"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Training
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-espresso mb-4">{editing ? "Edit Training" : "New Training"}</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Title *</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Training title"
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Brief description..."
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta resize-none" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Link / URL</label>
              <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..."
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta">
                <option value="general">General</option>
                <option value="onboarding">Onboarding</option>
                <option value="skills">Skills</option>
                <option value="compliance">Compliance</option>
                <option value="tools">Tools</option>
              </select>
            </div>
            {!editing && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-terracotta" />
                <span className="text-[13px] text-walnut">Send email notification to all VAs</span>
              </label>
            )}
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={handleSave} disabled={saving || !title.trim()}
              className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? "Saving..." : editing ? "Save Changes" : "Create Training"}
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

      {!loading && trainings.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-espresso">No trainings yet</p>
          <p className="mt-1 text-xs text-stone">Click &quot;Add Training&quot; to create the first one.</p>
        </div>
      )}

      {!loading && trainings.length > 0 && (
        <div className="space-y-3">
          {trainings.map((t) => (
            <div key={t.id} className={`rounded-xl border bg-white p-4 shadow-sm ${!t.is_active ? "opacity-60" : "border-sand"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-espresso">{t.title}</p>
                    {!t.is_active && <span className="rounded-full bg-parchment px-2 py-0.5 text-[10px] font-medium text-stone">Hidden</span>}
                    {t.category !== "general" && <span className="rounded-full bg-parchment px-2 py-0.5 text-[10px] font-medium text-walnut capitalize">{t.category}</span>}
                  </div>
                  {t.description && <p className="text-xs text-stone mt-0.5 truncate">{t.description}</p>}
                  {t.url && <p className="text-[11px] text-terracotta mt-0.5 truncate">{t.url}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => handleToggleActive(t)} className="text-[11px] text-stone hover:text-walnut cursor-pointer px-2 py-1 rounded border border-sand hover:border-walnut transition-all">
                    {t.is_active ? "Hide" : "Show"}
                  </button>
                  <button onClick={() => openEdit(t)} className="text-[11px] text-walnut hover:text-espresso cursor-pointer px-2 py-1 rounded border border-sand hover:border-walnut transition-all">Edit</button>
                  <button onClick={() => handleDelete(t.id)} disabled={!!deleting[t.id]} className="text-[11px] text-terracotta hover:text-red-600 cursor-pointer px-2 py-1 rounded border border-sand hover:border-terracotta transition-all disabled:opacity-50">
                    {deleting[t.id] ? "..." : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
