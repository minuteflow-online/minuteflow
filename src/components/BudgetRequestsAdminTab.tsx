"use client";

import { useCallback, useEffect, useState } from "react";

type BudgetRequestRow = {
  id: number;
  va_id: string;
  amount: number;
  unit: "hours" | "dollars";
  reason: string | null;
  status: "pending" | "approved" | "denied";
  reviewed_by: string | null;
  review_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
  va_name: string;
  reviewed_by_name: string | null;
};

function formatAmount(value: number, unit: "hours" | "dollars"): string {
  return unit === "dollars" ? `$${value.toFixed(2)}` : `${value.toFixed(2)}h`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const STATUS_BADGE: Record<BudgetRequestRow["status"], string> = {
  pending: "bg-amber-50 text-amber-600 border-amber-200",
  approved: "bg-emerald-50 text-emerald-600 border-emerald-200",
  denied: "bg-red-50 text-red-500 border-red-200",
};

export default function BudgetRequestsAdminTab() {
  const [requests, setRequests] = useState<BudgetRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [processing, setProcessing] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/budget-requests", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRequests((json.requests ?? []) as BudgetRequestRow[]);
    } catch {
      setError("Couldn't load budget requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (id: number, status: "approved" | "denied") => {
      setProcessing((p) => ({ ...p, [id]: true }));
      setError(null);
      try {
        const res = await fetch(`/api/budget-requests/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, review_notes: notes[id]?.trim() || null }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't update the request.");
      } finally {
        setProcessing((p) => ({ ...p, [id]: false }));
      }
    },
    [notes, load]
  );

  const visible = requests.filter((r) => (filter === "pending" ? r.status === "pending" : true));
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">
          Budget Requests {pendingCount > 0 && <span className="text-terracotta">({pendingCount} pending)</span>}
        </h3>
        <div className="inline-flex rounded-lg border border-sand bg-parchment/40 p-1 text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => setFilter("pending")}
            className={`rounded-md px-3 py-1 transition-colors ${filter === "pending" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
          >
            Pending
          </button>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded-md px-3 py-1 transition-colors ${filter === "all" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
          >
            All
          </button>
        </div>
      </div>

      {error && <p className="text-[12px] text-terracotta">{error}</p>}

      {loading ? (
        <p className="text-[12px] text-stone">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-[12px] text-stone italic py-2">No {filter === "pending" ? "pending " : ""}budget requests.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <div key={r.id} className="rounded-lg border border-sand bg-white p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[13px] font-semibold text-espresso">
                    {r.va_name} · <span className="text-terracotta">{formatAmount(r.amount, r.unit)}</span> more
                  </p>
                  <p className="text-[11px] text-stone">{formatDateTime(r.created_at)}</p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${STATUS_BADGE[r.status]}`}>
                  {r.status}
                </span>
              </div>

              {r.reason && <p className="text-[12px] text-espresso">{r.reason}</p>}

              {r.status === "pending" ? (
                <>
                  <input
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    placeholder="Note (optional)"
                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void act(r.id, "approved")}
                      disabled={processing[r.id]}
                      className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white hover:bg-sage/90 disabled:opacity-50"
                    >
                      {processing[r.id] ? "…" : "Approve"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void act(r.id, "denied")}
                      disabled={processing[r.id]}
                      className="rounded-lg bg-stone/10 px-3 py-1 text-[11px] font-semibold text-stone hover:bg-stone/20 disabled:opacity-50"
                    >
                      Deny
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-stone">
                  {r.status === "approved" ? "Approved" : "Denied"}
                  {r.reviewed_by_name ? ` by ${r.reviewed_by_name}` : ""}
                  {r.reviewed_at ? ` · ${formatDateTime(r.reviewed_at)}` : ""}
                  {r.review_notes ? ` — “${r.review_notes}”` : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
