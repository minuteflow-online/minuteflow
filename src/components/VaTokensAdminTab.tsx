"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface Profile {
  id: string;
  full_name: string;
  role: string;
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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function VaTokensAdminTab() {
  const supabase = createClient();
  const [vas, setVas] = useState<Profile[]>([]);
  const [tokens, setTokens] = useState<VaToken[]>([]);
  const [ratings, setRatings] = useState<VaDailyRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<"tokens" | "ratings">("tokens");

  // Token form
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [tokenVa, setTokenVa] = useState("");
  const [tokenAmount, setTokenAmount] = useState("1");
  const [tokenReason, setTokenReason] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [tokenMsg, setTokenMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [deletingToken, setDeletingToken] = useState<Record<number, boolean>>({});

  // Rating form
  const [showRatingForm, setShowRatingForm] = useState(false);
  const [ratingVa, setRatingVa] = useState("");
  const [ratingDate, setRatingDate] = useState(new Date().toISOString().split("T")[0]);
  const [ratingScore, setRatingScore] = useState<number | null>(null);
  const [ratingNotes, setRatingNotes] = useState("");
  const [savingRating, setSavingRating] = useState(false);
  const [ratingMsg, setRatingMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [deletingRating, setDeletingRating] = useState<Record<number, boolean>>({});

  const [filterVa, setFilterVa] = useState("all");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tokRes, ratRes, { data: profileData }] = await Promise.all([
        fetch("/api/va-tokens").then((r) => r.json()),
        fetch("/api/va-ratings").then((r) => r.json()),
        supabase.from("profiles").select("id, full_name, role").neq("role", "admin"),
      ]);
      setTokens(tokRes.tokens || []);
      setRatings(ratRes.ratings || []);
      setVas((profileData as Profile[]) || []);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleAwardToken = useCallback(async () => {
    if (!tokenVa || !tokenReason.trim()) return;
    setSavingToken(true); setTokenMsg(null);
    const res = await fetch("/api/va-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: tokenVa, amount: parseInt(tokenAmount) || 1, reason: tokenReason.trim() }),
    });
    setSavingToken(false);
    if (res.ok) {
      setTokenMsg({ type: "ok", text: "Token awarded!" });
      setTimeout(() => setTokenMsg(null), 3000);
      setTokenVa(""); setTokenAmount("1"); setTokenReason(""); setShowTokenForm(false);
      fetchAll();
    } else {
      const e = await res.json();
      setTokenMsg({ type: "err", text: e.error || "Failed" });
    }
  }, [tokenVa, tokenAmount, tokenReason, fetchAll]);

  const handleDeleteToken = useCallback(async (id: number) => {
    if (!confirm("Remove this token award?")) return;
    setDeletingToken((d) => ({ ...d, [id]: true }));
    await fetch(`/api/va-tokens?id=${id}`, { method: "DELETE" });
    await fetchAll();
    setDeletingToken((d) => ({ ...d, [id]: false }));
  }, [fetchAll]);

  const handleSaveRating = useCallback(async () => {
    if (!ratingVa || !ratingScore) return;
    setSavingRating(true); setRatingMsg(null);
    const res = await fetch("/api/va-ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ va_id: ratingVa, rating_date: ratingDate, score: ratingScore, notes: ratingNotes.trim() || null }),
    });
    setSavingRating(false);
    if (res.ok) {
      setRatingMsg({ type: "ok", text: "Rating saved!" });
      setTimeout(() => setRatingMsg(null), 3000);
      setRatingVa(""); setRatingScore(null); setRatingNotes(""); setShowRatingForm(false);
      fetchAll();
    } else {
      const e = await res.json();
      setRatingMsg({ type: "err", text: e.error || "Failed" });
    }
  }, [ratingVa, ratingDate, ratingScore, ratingNotes, fetchAll]);

  const handleDeleteRating = useCallback(async (id: number) => {
    if (!confirm("Delete this rating?")) return;
    setDeletingRating((d) => ({ ...d, [id]: true }));
    await fetch(`/api/va-ratings?id=${id}`, { method: "DELETE" });
    await fetchAll();
    setDeletingRating((d) => ({ ...d, [id]: false }));
  }, [fetchAll]);

  const filteredTokens = filterVa === "all" ? tokens : tokens.filter((t) => t.user_id === filterVa);
  const filteredRatings = filterVa === "all" ? ratings : ratings.filter((r) => r.va_id === filterVa);

  // Token totals per VA
  const tokenTotals: Record<string, number> = {};
  tokens.forEach((t) => { tokenTotals[t.user_id] = (tokenTotals[t.user_id] || 0) + t.amount; });

  const STARS = [1, 2, 3, 4, 5];

  return (
    <div className="max-w-4xl space-y-6">
      {/* View toggle + VA filter */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex rounded-lg border border-sand overflow-hidden">
          <button onClick={() => setActiveView("tokens")} className={`px-4 py-2 text-[12px] font-semibold transition-all cursor-pointer ${activeView === "tokens" ? "bg-terracotta text-white" : "bg-white text-walnut hover:bg-parchment"}`}>Tokens</button>
          <button onClick={() => setActiveView("ratings")} className={`px-4 py-2 text-[12px] font-semibold transition-all cursor-pointer ${activeView === "ratings" ? "bg-terracotta text-white" : "bg-white text-walnut hover:bg-parchment"}`}>Daily Ratings</button>
        </div>
        <button
          onClick={() => activeView === "tokens" ? setShowTokenForm(!showTokenForm) : setShowRatingForm(!showRatingForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840]"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {activeView === "tokens" ? "Award Token" : "Add Rating"}
        </button>
      </div>

      {/* VA Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setFilterVa("all")} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all cursor-pointer ${filterVa === "all" ? "bg-terracotta text-white border-terracotta" : "bg-white text-walnut border-sand hover:border-terracotta"}`}>All</button>
        {vas.map((v) => (
          <button key={v.id} onClick={() => setFilterVa(v.id)} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all cursor-pointer ${filterVa === v.id ? "bg-terracotta text-white border-terracotta" : "bg-white text-walnut border-sand hover:border-terracotta"}`}>
            {v.full_name} {tokenTotals[v.id] ? `(${tokenTotals[v.id]}🟡)` : ""}
          </button>
        ))}
      </div>

      {/* Token Form */}
      {activeView === "tokens" && showTokenForm && (
        <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-espresso mb-4">Award Token</h3>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">VA *</label>
                <select value={tokenVa} onChange={(e) => setTokenVa(e.target.value)}
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta">
                  <option value="">Select VA...</option>
                  {vas.map((v) => <option key={v.id} value={v.id}>{v.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Amount</label>
                <input type="number" min="1" max="100" value={tokenAmount} onChange={(e) => setTokenAmount(e.target.value)}
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Reason *</label>
              <input type="text" value={tokenReason} onChange={(e) => setTokenReason(e.target.value)} placeholder="e.g. Excellent work this week"
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta" />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={handleAwardToken} disabled={savingToken || !tokenVa || !tokenReason.trim()}
              className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed">
              {savingToken ? "Awarding..." : "Award Token"}
            </button>
            <button onClick={() => setShowTokenForm(false)} className="text-xs text-stone hover:text-espresso cursor-pointer">Cancel</button>
            {tokenMsg && <p className={`text-xs font-medium ${tokenMsg.type === "ok" ? "text-sage" : "text-red-500"}`}>{tokenMsg.text}</p>}
          </div>
        </div>
      )}

      {/* Rating Form */}
      {activeView === "ratings" && showRatingForm && (
        <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-espresso mb-4">Add Daily Rating</h3>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">VA *</label>
                <select value={ratingVa} onChange={(e) => setRatingVa(e.target.value)}
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta">
                  <option value="">Select VA...</option>
                  {vas.map((v) => <option key={v.id} value={v.id}>{v.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Date</label>
                <input type="date" value={ratingDate} onChange={(e) => setRatingDate(e.target.value)}
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-2 tracking-wide">Score * (1–5)</label>
              <div className="flex gap-2">
                {STARS.map((s) => (
                  <button key={s} onClick={() => setRatingScore(ratingScore === s ? null : s)}
                    className={`h-10 w-10 rounded-lg border text-sm font-bold transition-all cursor-pointer ${ratingScore && s <= ratingScore ? "bg-amber text-white border-amber" : "bg-white text-stone border-sand hover:border-amber"}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">Notes</label>
              <input type="text" value={ratingNotes} onChange={(e) => setRatingNotes(e.target.value)} placeholder="Optional notes..."
                className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta" />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={handleSaveRating} disabled={savingRating || !ratingVa || !ratingScore}
              className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed">
              {savingRating ? "Saving..." : "Save Rating"}
            </button>
            <button onClick={() => setShowRatingForm(false)} className="text-xs text-stone hover:text-espresso cursor-pointer">Cancel</button>
            {ratingMsg && <p className={`text-xs font-medium ${ratingMsg.type === "ok" ? "text-sage" : "text-red-500"}`}>{ratingMsg.text}</p>}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-stone">
          <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />Loading...
        </div>
      )}

      {/* Tokens List */}
      {!loading && activeView === "tokens" && (
        <div className="space-y-2">
          {filteredTokens.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm font-medium text-espresso">No tokens awarded yet</p>
              <p className="mt-1 text-xs text-stone">Click &quot;Award Token&quot; to recognize great work.</p>
            </div>
          ) : filteredTokens.map((t) => (
            <div key={t.id} className="rounded-xl border border-sand bg-white p-4 shadow-sm flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-espresso">{t.va_name}</p>
                <p className="text-sm font-medium text-espresso truncate">{t.reason}</p>
                <p className="text-[11px] text-stone mt-0.5">{fmtDate(t.awarded_at)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="rounded-full bg-terracotta px-3 py-1 text-sm font-bold text-white">+{t.amount}</span>
                <button onClick={() => handleDeleteToken(t.id)} disabled={!!deletingToken[t.id]} className="text-[11px] text-stone hover:text-terracotta cursor-pointer px-2 py-1 rounded border border-sand hover:border-terracotta transition-all disabled:opacity-50">
                  {deletingToken[t.id] ? "..." : "×"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ratings List */}
      {!loading && activeView === "ratings" && (
        <div className="space-y-2">
          {filteredRatings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm font-medium text-espresso">No ratings yet</p>
              <p className="mt-1 text-xs text-stone">Click &quot;Add Rating&quot; to rate VA performance.</p>
            </div>
          ) : filteredRatings.map((r) => (
            <div key={r.id} className="rounded-xl border border-sand bg-white p-4 shadow-sm flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-espresso">{r.va_name}</p>
                <p className="text-sm font-medium text-espresso">{new Date(r.rating_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</p>
                {r.notes && <p className="text-xs text-stone mt-0.5 truncate">{r.notes}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-0.5">
                  {STARS.map((s) => (
                    <svg key={s} className={`h-4 w-4 ${s <= r.score ? "text-amber fill-current" : "text-sand"}`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  ))}
                </div>
                <button onClick={() => handleDeleteRating(r.id)} disabled={!!deletingRating[r.id]} className="text-[11px] text-stone hover:text-terracotta cursor-pointer px-2 py-1 rounded border border-sand hover:border-terracotta transition-all disabled:opacity-50">
                  {deletingRating[r.id] ? "..." : "×"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
