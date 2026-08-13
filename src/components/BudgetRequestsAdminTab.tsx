"use client";

import { useCallback, useEffect, useState } from "react";

type TeamMember = { id: string; full_name: string; username: string; role: string };

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
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [processing, setProcessing] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // Grant Budget — admin gives a VA extra budget directly, no request needed.
  const [showGrant, setShowGrant] = useState(false);
  const [grantVaId, setGrantVaId] = useState("");
  const [grantAmount, setGrantAmount] = useState("");
  const [grantUnit, setGrantUnit] = useState<"hours" | "dollars">("hours");
  const [grantReason, setGrantReason] = useState("");
  const [granting, setGranting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, membersRes] = await Promise.all([
        fetch("/api/budget-requests", { cache: "no-store" }),
        fetch("/api/team-members", { cache: "no-store" }),
      ]);
      if (!reqRes.ok) throw new Error(`HTTP ${reqRes.status}`);
      const reqJson = await reqRes.json();
      setRequests((reqJson.requests ?? []) as BudgetRequestRow[]);
      if (membersRes.ok) {
        const memJson = await membersRes.json();
        setMembers(((memJson.members ?? []) as TeamMember[]).filter((m) => m.role === "va"));
      }
    } catch {
      setError("Couldn't load budget requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitGrant = useCallback(async () => {
    const amount = Number(grantAmount);
    if (!grantVaId) {
      setError("Pick a VA to grant budget to.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a positive amount.");
      return;
    }
    setGranting(true);
    setError(null);
    try {
      const res = await fetch("/api/budget-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ va_id: grantVaId, amount, unit: grantUnit, reason: grantReason.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setShowGrant(false);
      setGrantVaId("");
      setGrantAmount("");
      setGrantReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't grant budget.");
    } finally {
      setGranting(false);
    }
  }, [grantVaId, grantAmount, grantUnit, grantReason, load]);

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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowGrant((v) => !v)}
            className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white hover:bg-sage/90 transition-colors"
          >
            + Grant Budget
          </button>
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
      </div>

      {showGrant && (
        <div className="space-y-2 rounded-lg border border-sand bg-parchment/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-walnut">Grant Budget Directly</p>
          <p className="text-[10px] text-stone">Adds to that VA&apos;s budget for today only — doesn&apos;t change their permanent shift.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select
              value={grantVaId}
              onChange={(e) => setGrantVaId(e.target.value)}
              className="rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
            >
              <option value="">Select VA…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name || m.username}</option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step={grantUnit === "dollars" ? "0.01" : "0.25"}
              value={grantAmount}
              onChange={(e) => setGrantAmount(e.target.value)}
              placeholder={grantUnit === "dollars" ? "Amount ($)" : "Amount (hrs)"}
              className="rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
            />
            <select
              value={grantUnit}
              onChange={(e) => setGrantUnit(e.target.value as "hours" | "dollars")}
              className="rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
            >
              <option value="hours">Hours</option>
              <option value="dollars">Dollars</option>
            </select>
          </div>
          <input
            value={grantReason}
            onChange={(e) => setGrantReason(e.target.value)}
            placeholder="Reason (optional)"
            className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void submitGrant()}
              disabled={granting}
              className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white hover:bg-sage/90 disabled:opacity-50"
            >
              {granting ? "Granting…" : "Grant"}
            </button>
            <button
              type="button"
              onClick={() => setShowGrant(false)}
              className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone hover:bg-stone/20"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
