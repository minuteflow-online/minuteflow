"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface Profile {
  id: string;
  full_name: string;
  role: string;
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
  is_visible_to_va: boolean;
  created_at: string;
  va_name?: string;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function VaReviewsAdminTab() {
  const supabase = createClient();
  const [reviews, setReviews] = useState<VaReview[]>([]);
  const [vas, setVas] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<VaReview | null>(null);
  const [deleting, setDeleting] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [filterVa, setFilterVa] = useState("all");

  const [selectedVa, setSelectedVa] = useState("");
  const [title, setTitle] = useState("");
  const [period, setPeriod] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [comments, setComments] = useState("");
  const [visibleToVa, setVisibleToVa] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [revRes, { data: profileData }] = await Promise.all([
        fetch("/api/va-reviews").then((r) => r.json()),
        supabase.from("profiles").select("id, full_name, role").neq("role", "admin"),
      ]);
      setReviews(revRes.reviews || []);
      setVas((profileData as Profile[]) || []);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const resetForm = () => {
    setSelectedVa(""); setTitle(""); setPeriod(""); setRating(null);
    setStrengths(""); setImprovements(""); setComments(""); setVisibleToVa(false); setEditing(null);
  };

  const openEdit = (r: VaReview) => {
    setEditing(r);
    setSelectedVa(r.user_id);
    setTitle(r.title);
    setPeriod(r.period);
    setRating(r.overall_rating);
    setStrengths(r.strengths || "");
    setImprovements(r.improvements || "");
    setComments(r.comments || "");
    setVisibleToVa(r.is_visible_to_va);
    setShowForm(true);
  };

  const handleSave = useCallback(async () => {
    if (!selectedVa || !title.trim() || !period.trim()) return;
    setSaving(true); setSaveMsg(null);

    const body = {
      user_id: selectedVa, title: title.trim(), period: period.trim(),
      overall_rating: rating, strengths: strengths.trim() || null,
      improvements: improvements.trim() || null, comments: comments.trim() || null,
      is_visible_to_va: visibleToVa,
    };

    const res = editing
      ? await fetch(`/api/va-reviews?id=${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/va-reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    setSaving(false);
    if (res.ok) {
      setSaveMsg({ type: "ok", text: editing ? "Review updated!" : "Review created!" });
      setTimeout(() => setSaveMsg(null), 3000);
      resetForm(); setShowForm(false);
      fetchAll();
    } else {
      const e = await res.json();
      setSaveMsg({ type: "err", text: e.error || "Failed to save" });
    }
  }, [selectedVa, title, period, rating, strengths, improvements, comments, visibleToVa, editing, fetchAll]);

  const handleDelete = useCallback(async (id: number) => {
    if (!confirm("Delete this review?")) return;
    setDeleting((d) => ({ ...d, [id]: true }));
    await fetch(`/api/va-reviews?id=${id}`, { method: "DELETE" });
    await fetchAll();
    setDeleting((d) => ({ ...d, [id]: false }));
  }, [fetchAll]);

  const handleToggleVisible = useCallback(async (r: VaReview) => {
    await fetch(`/api/va-reviews?id=${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_visible_to_va: !r.is_visible_to_va }),
    });
    fetchAll();
  }, [fetchAll]);

  const filtered = filterVa === "all" ? reviews : reviews.filter((r) => r.user_id === filterVa);
  const STARS = [1, 2, 3, 4, 5];

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* VA filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setFilterVa("all")} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all cursor-pointer ${filterVa === "all" ? "bg-terracotta text-white border-terracotta" : "bg-white text-walnut border-sand hover:border-terracotta"}`}>All VAs</button>
          {vas.map((v) => (
            <button key={v.id} onClick={() => setFilterVa(v.id)} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all cursor-pointer ${filterVa === v.id ? "bg-terracotta text-white border-terracotta" : "bg-white text-walnut border-sand hover:border-terracotta"}`}>
              {v.full_name}
            </button>
          ))}
        </div>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }}
          className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840]">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Review
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-espresso mb-4">{editing ? "Edit Review" : "New Performance Review"}</h3>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">VA *</label>
                <select value={selectedVa} onChange={(e) => setSelectedVa(e.target.value)}
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta">
                  <option value="">Select VA...</option>
                  {vas.map((v) => <option key={v.id} value={v.id}>{v.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Period *</label>
                <input type="text" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. Q1 2025, May 2025"
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Review Title *</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q1 Performance Review"
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-2 tracking-wide">Overall Rating</label>
              <div className="flex gap-2">
                {STARS.map((s) => (
                  <button key={s} onClick={() => setRating(rating === s ? null : s)}
                    className={`h-9 w-9 rounded-lg border text-sm font-bold transition-all cursor-pointer ${rating && s <= rating ? "bg-amber text-white border-amber" : "bg-white text-stone border-sand hover:border-amber"}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Strengths</label>
              <textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} rows={2} placeholder="What they do well..."
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta resize-none" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Areas to Improve</label>
              <textarea value={improvements} onChange={(e) => setImprovements(e.target.value)} rows={2} placeholder="Growth opportunities..."
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta resize-none" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Additional Comments</label>
              <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2} placeholder="Any other notes..."
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta resize-none" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={visibleToVa} onChange={(e) => setVisibleToVa(e.target.checked)} className="accent-terracotta" />
              <span className="text-[13px] text-walnut">Publish to VA portal (VA can see this)</span>
            </label>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={handleSave} disabled={saving || !selectedVa || !title.trim() || !period.trim()}
              className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? "Saving..." : editing ? "Save Changes" : "Create Review"}
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

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-espresso">No reviews yet</p>
          <p className="mt-1 text-xs text-stone">Click &quot;Add Review&quot; to create the first performance review.</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-4">
          {filtered.map((r) => (
            <div key={r.id} className="rounded-xl border border-sand bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="text-sm font-semibold text-espresso">{r.va_name}</p>
                  <p className="text-sm font-medium text-espresso mt-0.5">{r.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="inline-flex items-center rounded-full bg-parchment px-2 py-0.5 text-[11px] font-medium text-walnut">{r.period}</span>
                    <span className="text-[11px] text-stone">{fmtDate(r.created_at)}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${r.is_visible_to_va ? "bg-sage-soft text-sage" : "bg-parchment text-stone"}`}>
                      {r.is_visible_to_va ? "Published" : "Draft"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {r.overall_rating && (
                    <div className="flex items-center gap-0.5">
                      {STARS.map((s) => (
                        <svg key={s} className={`h-3.5 w-3.5 ${s <= r.overall_rating! ? "text-amber fill-current" : "text-sand"}`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {expanded[r.id] && (
                <div className="space-y-3 mt-3 pt-3 border-t border-parchment">
                  {r.strengths && <div><p className="text-[11px] font-semibold text-walnut mb-0.5">Strengths</p><p className="text-xs text-bark">{r.strengths}</p></div>}
                  {r.improvements && <div><p className="text-[11px] font-semibold text-walnut mb-0.5">Areas to Improve</p><p className="text-xs text-bark">{r.improvements}</p></div>}
                  {r.comments && <div><p className="text-[11px] font-semibold text-walnut mb-0.5">Comments</p><p className="text-xs text-bark">{r.comments}</p></div>}
                </div>
              )}

              {(r.strengths || r.improvements || r.comments) && (
                <button onClick={() => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))} className="mt-2 text-[11px] text-terracotta hover:underline cursor-pointer">
                  {expanded[r.id] ? "Show less" : "See details"}
                </button>
              )}

              <div className="flex gap-2 mt-3">
                <button onClick={() => handleToggleVisible(r)} className={`text-[11px] cursor-pointer px-2 py-1 rounded border transition-all ${r.is_visible_to_va ? "text-stone border-sand hover:border-walnut hover:text-walnut" : "text-sage border-sage hover:bg-sage-soft"}`}>
                  {r.is_visible_to_va ? "Unpublish" : "Publish to VA"}
                </button>
                <button onClick={() => openEdit(r)} className="text-[11px] text-walnut hover:text-espresso cursor-pointer px-2 py-1 rounded border border-sand hover:border-walnut transition-all">Edit</button>
                <button onClick={() => handleDelete(r.id)} disabled={!!deleting[r.id]} className="text-[11px] text-terracotta hover:text-red-600 cursor-pointer px-2 py-1 rounded border border-sand hover:border-terracotta transition-all disabled:opacity-50">
                  {deleting[r.id] ? "..." : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
