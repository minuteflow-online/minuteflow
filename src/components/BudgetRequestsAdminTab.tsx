"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import ColumnHeader from "@/components/table/ColumnHeader";

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
  period: "day" | "week" | "month";
  va_name: string;
  reviewed_by_name: string | null;
  archived_at: string | null;
};

const PAGE_SIZE = 10;

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
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [processing, setProcessing] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // Past-requests table: filters live on the column titles, archived rows are
  // hidden until asked for, and a row opens to show the reason in full.
  const [openRows, setOpenRows] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [filterNames, setFilterNames] = useState<string[]>([]);
  const [filterPeriods, setFilterPeriods] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterReviewers, setFilterReviewers] = useState<string[]>([]);
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    name: 200, amount: 110, period: 110, requested: 150, status: 120, reviewer: 180,
  });
  const setColumnWidth = (key: string, w: number) =>
    setColWidths((prev) => ({ ...prev, [key]: w }));

  // Grant Budget — admin gives a VA extra budget directly, no request needed.
  const [showGrant, setShowGrant] = useState(false);
  const [grantVaId, setGrantVaId] = useState("");
  const [grantAmount, setGrantAmount] = useState("");
  const [grantUnit, setGrantUnit] = useState<"hours" | "dollars">("hours");
  const [grantPeriod, setGrantPeriod] = useState<"day" | "week" | "month">("day");
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
        body: JSON.stringify({ va_id: grantVaId, amount, unit: grantUnit, period: grantPeriod, reason: grantReason.trim() || null }),
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
  }, [grantVaId, grantAmount, grantUnit, grantPeriod, grantReason, load]);

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

  const setArchived = useCallback(
    async (id: number, archived: boolean) => {
      setProcessing((p) => ({ ...p, [id]: true }));
      try {
        const res = await fetch(`/api/budget-requests/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived }),
        });
        if (!res.ok) throw new Error("Couldn't archive that request.");
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't archive that request.");
      } finally {
        setProcessing((p) => ({ ...p, [id]: false }));
      }
    },
    [load]
  );

  const remove = useCallback(
    async (r: BudgetRequestRow) => {
      if (!confirm(`Delete ${r.va_name}'s request for ${formatAmount(r.amount, r.unit)}?

This removes the record permanently. Budget already granted is not taken back.`)) {
        return;
      }
      setProcessing((p) => ({ ...p, [r.id]: true }));
      try {
        const res = await fetch(`/api/budget-requests/${r.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Couldn't delete that request.");
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't delete that request.");
      } finally {
        setProcessing((p) => ({ ...p, [r.id]: false }));
      }
    },
    [load]
  );

  const pending = requests.filter((r) => r.status === "pending");
  const reviewed = requests.filter((r) => r.status !== "pending");
  const periodLabel = (p: BudgetRequestRow["period"]) =>
    p === "day" ? "Daily" : p === "week" ? "Weekly" : "Monthly";

  const nameOptions = Array.from(new Set(reviewed.map((r) => r.va_name))).sort();
  const reviewerOptions = Array.from(
    new Set(reviewed.map((r) => r.reviewed_by_name).filter((n): n is string => Boolean(n)))
  ).sort();

  const history = reviewed.filter((r) => {
    if (Boolean(r.archived_at) !== showArchived) return false;
    if (filterNames.length > 0 && !filterNames.includes(r.va_name)) return false;
    if (filterPeriods.length > 0 && !filterPeriods.includes(periodLabel(r.period))) return false;
    if (filterStatuses.length > 0 && !filterStatuses.includes(r.status)) return false;
    if (filterReviewers.length > 0 && !filterReviewers.includes(r.reviewed_by_name ?? "")) return false;
    return true;
  });

  const pageCount = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = history.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const archivedCount = reviewed.filter((r) => r.archived_at).length;
  const pendingCount = pending.length;

  return (
    <div className="space-y-4">
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
            <select
              value={grantPeriod}
              onChange={(e) => setGrantPeriod(e.target.value as "day" | "week" | "month")}
              className="rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
            >
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
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
      ) : pending.length === 0 ? (
        <p className="text-[12px] text-stone italic py-2">No pending budget requests.</p>
      ) : (
        <div className="space-y-2">
          {pending.map((r) => (
            <div key={r.id} className="rounded-lg border border-sand bg-white p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[13px] font-semibold text-espresso">
                    {r.va_name} · <span className="text-terracotta">{formatAmount(r.amount, r.unit)}</span> more
                    <span className="ml-1.5 rounded-full bg-slate-blue-soft px-1.5 py-[1px] align-middle text-[10px] font-semibold text-slate-blue">
                      {r.period === "day" ? "Daily" : r.period === "week" ? "Weekly" : "Monthly"}
                    </span>
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

    {/* Reviewed requests are a record, not a queue. One line each, opened for
        the reason; filters sit on the column titles; archiving files a row away
        without deleting it. */}
    {reviewed.length > 0 && (
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">
            {showArchived ? "Archived Requests" : "Past Requests"}{" "}
            <span className="text-stone font-semibold">({history.length})</span>
          </h3>
          <div className="flex items-center gap-2">
            {filterNames.length + filterPeriods.length + filterStatuses.length + filterReviewers.length > 0 && (
              <button
                onClick={() => {
                  setFilterNames([]);
                  setFilterPeriods([]);
                  setFilterStatuses([]);
                  setFilterReviewers([]);
                }}
                className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
              >
                Clear filters
              </button>
            )}
            <button
              onClick={() => {
                setShowArchived((v) => !v);
                setPage(0);
              }}
              className={`px-3 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                showArchived ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
              }`}
            >
              {showArchived ? "Back to active" : `Archived (${archivedCount})`}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-sand bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-parchment bg-parchment/30">
                  <th className="w-8 border-b border-sand bg-parchment px-2 py-2.5" />
                  <ColumnHeader
                    label="Name"
                    width={colWidths.name}
                    onResize={(w) => setColumnWidth("name", w)}
                    filterOptions={nameOptions.map((v) => ({ value: v, label: v }))}
                    selected={filterNames}
                    onFilterChange={(v) => {
                      setFilterNames(v);
                      setPage(0);
                    }}
                    searchable
                  />
                  <ColumnHeader label="Amount" width={colWidths.amount} onResize={(w) => setColumnWidth("amount", w)} />
                  <ColumnHeader
                    label="Period"
                    width={colWidths.period}
                    onResize={(w) => setColumnWidth("period", w)}
                    filterOptions={[
                      { value: "Daily", label: "Daily" },
                      { value: "Weekly", label: "Weekly" },
                      { value: "Monthly", label: "Monthly" },
                    ]}
                    selected={filterPeriods}
                    onFilterChange={(v) => {
                      setFilterPeriods(v);
                      setPage(0);
                    }}
                  />
                  <ColumnHeader
                    label="Requested"
                    width={colWidths.requested}
                    onResize={(w) => setColumnWidth("requested", w)}
                  />
                  <ColumnHeader
                    label="Status"
                    width={colWidths.status}
                    onResize={(w) => setColumnWidth("status", w)}
                    filterOptions={[
                      { value: "approved", label: "approved" },
                      { value: "denied", label: "denied" },
                    ]}
                    selected={filterStatuses}
                    onFilterChange={(v) => {
                      setFilterStatuses(v);
                      setPage(0);
                    }}
                  />
                  <ColumnHeader
                    label="Reviewed By"
                    width={colWidths.reviewer}
                    onResize={(w) => setColumnWidth("reviewer", w)}
                    filterOptions={reviewerOptions.map((v) => ({ value: v, label: v }))}
                    selected={filterReviewers}
                    onFilterChange={(v) => {
                      setFilterReviewers(v);
                      setPage(0);
                    }}
                  />
                  <th className="border-b border-sand bg-parchment px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-walnut">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-parchment">
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-[13px] text-bark">
                      {showArchived ? "Nothing archived." : "No requests match your filters."}
                    </td>
                  </tr>
                )}
                {pageRows.map((r) => {
                  const isOpen = openRows.has(r.id);
                  const hasDetail = Boolean(r.reason || r.review_notes);
                  return (
                    <Fragment key={r.id}>
                      <tr className="hover:bg-parchment/20 transition-colors">
                        <td className="px-2 py-3">
                          {hasDetail && (
                            <button
                              onClick={() =>
                                setOpenRows((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(r.id)) next.delete(r.id);
                                  else next.add(r.id);
                                  return next;
                                })
                              }
                              aria-label={isOpen ? "Hide reason" : "Show reason"}
                              className="text-[10px] text-bark hover:text-espresso transition-colors"
                            >
                              {isOpen ? "\u25be" : "\u25b8"}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-3 font-semibold text-espresso">{r.va_name}</td>
                        <td className="px-3 py-3 font-semibold text-terracotta whitespace-nowrap">
                          {formatAmount(r.amount, r.unit)}
                        </td>
                        <td className="px-3 py-3 text-espresso">{periodLabel(r.period)}</td>
                        <td className="px-3 py-3 text-stone whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                        <td className="px-3 py-3">
                          <span
                            className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${STATUS_BADGE[r.status]}`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-stone whitespace-nowrap">
                          {r.reviewed_by_name || "\u2014"}
                          {r.reviewed_at && (
                            <span className="block text-[10px] text-stone/70">{formatDateTime(r.reviewed_at)}</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => void setArchived(r.id, !r.archived_at)}
                            disabled={processing[r.id]}
                            className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors disabled:opacity-50"
                          >
                            {r.archived_at ? "Restore" : "Archive"}
                          </button>
                          <button
                            onClick={() => void remove(r)}
                            disabled={processing[r.id]}
                            title="Delete permanently"
                            className="ml-1 px-2 py-1 text-bark hover:text-terracotta transition-colors disabled:opacity-50"
                          >
                            &times;
                          </button>
                        </td>
                      </tr>
                      {isOpen && hasDetail && (
                        <tr className="bg-cream/40">
                          <td />
                          <td colSpan={7} className="px-3 pb-3 pt-0">
                            {r.reason && <p className="text-[12px] text-espresso">{r.reason}</p>}
                            {r.review_notes && (
                              <p className="mt-1 text-[11px] italic text-stone">&ldquo;{r.review_notes}&rdquo;</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between border-t border-parchment px-3 py-2">
              <span className="text-[11px] text-bark">
                {currentPage * PAGE_SIZE + 1}&ndash;{Math.min((currentPage + 1) * PAGE_SIZE, history.length)} of{" "}
                {history.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((n) => Math.max(0, n - 1))}
                  disabled={currentPage === 0}
                  className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="px-2 text-[11px] text-bark">
                  Page {currentPage + 1} of {pageCount}
                </span>
                <button
                  onClick={() => setPage((n) => Math.min(pageCount - 1, n + 1))}
                  disabled={currentPage >= pageCount - 1}
                  className="px-3 py-1 rounded-lg text-[10px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}
    </div>
  );
}
